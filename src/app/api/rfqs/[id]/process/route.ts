import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeAndCategorize } from "@/lib/ai/normalize";
import { parsePdf } from "@/lib/parsers/pdf";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("id, raw_text, file_type, file_name")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  let rawText = (rfq.raw_text ?? "").trim();

  // If stored as base64 PDF (pdf-parse failed at fetch time), try parsing now
  if (rawText.startsWith("base64pdf:")) {
    const base64 = rawText.slice("base64pdf:".length);
    const buffer = Buffer.from(base64, "base64");
    try {
      rawText = await parsePdf(buffer);
    } catch {
      rawText = "";
    }
  }

  // If stored as base64 image — not supported without vision model
  if (rawText.startsWith("base64img:")) {
    return NextResponse.json(
      { error: "Image attachments cannot be processed automatically. Please upload the file manually via Upload RFQ." },
      { status: 422 }
    );
  }

  if (!rawText.trim()) {
    return NextResponse.json(
      { error: "No text could be extracted from this email. Please upload the file manually via Upload RFQ." },
      { status: 422 }
    );
  }

  await supabase.from("rfqs").update({ status: "processing" }).eq("id", id);

  let items;
  try {
    items = await normalizeAndCategorize(rawText);
  } catch (err: unknown) {
    await supabase.from("rfqs").update({ status: "pending" }).eq("id", id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI processing failed" },
      { status: 500 }
    );
  }

  if (items.length > 0) {
    await supabase.from("rfq_items").delete().eq("rfq_id", id);
    await supabase.from("rfq_items").insert(
      items.map((item) => ({
        rfq_id:              id,
        user_id:             user.id,
        line_number:         item.line_number,
        raw_text:            item.raw_text,
        name:                item.name,
        qty:                 item.qty,
        unit:                item.unit,
        brand:               item.brand,
        spec:                item.spec,
        notes:               item.notes,
        category:            item.category,
        category_source:     item.category_source,
        category_confidence: item.category_confidence,
        flagged:             item.category_confidence < 0.7,
      }))
    );
  }

  await supabase.from("rfqs").update({ status: "processed" }).eq("id", id);
  return NextResponse.json({ itemCount: items.length });
}
