import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { normalizeAndCategorize } from "@/lib/ai/normalize";

async function extractTextViaOpenAI(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const isPdf  = mimeType.includes("pdf");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: isPdf
          ? [
              { type: "text", text: "Extract all text from this RFQ document. Return just the raw text, preserve item names, quantities and units." },
              { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${base64}` } },
            ]
          : [
              { type: "text", text: "Extract all text from this RFQ image. Return just the raw text, no commentary." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
      }],
    }),
  });
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

// Generate sequential RFQ code like RFQ-2026-00001
function generateRfqCode(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 90000) + 10000;
  return `RFQ-${year}-${seq}`;
}

function detectFileType(filename: string, mime: string): "pdf" | "excel" | "image" | "text" {
  const lower = filename.toLowerCase();
  if (mime.includes("pdf") || lower.endsWith(".pdf"))                         return "pdf";
  if (mime.includes("image"))                                                  return "image";
  if (lower.endsWith(".txt") || lower.endsWith(".csv") || mime.includes("text/plain") || mime.includes("text/csv")) return "text";
  return "excel";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const formData  = await request.formData();
    const file      = formData.get("file") as File | null;
    const buyerName = (formData.get("buyerName") as string) || null;
    const buyerEmail = (formData.get("buyerEmail") as string) || null;
    const priority  = (formData.get("priority") as string) || "normal";

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const bytes    = await file.arrayBuffer();
    const buffer   = Buffer.from(bytes);
    const fileType = detectFileType(file.name, file.type);

    // 1 — Parse the file into raw text
    let rawText = "";
    if (fileType === "pdf") {
      try {
        rawText = await parsePdf(buffer);
      } catch {
        // Malformed PDF — fall back to OpenAI which handles any PDF via base64
        rawText = await extractTextViaOpenAI(buffer, "application/pdf");
      }
    } else if (fileType === "excel") {
      rawText = parseExcel(buffer);
    } else if (fileType === "text") {
      rawText = buffer.toString("utf-8");
    } else {
      // Image — send to OpenAI Vision
      rawText = await extractTextViaOpenAI(buffer, file.type || "image/jpeg");
    }

    if (!rawText.trim()) {
      return NextResponse.json({ error: "Could not extract any text from this file." }, { status: 422 });
    }

    // 2 — Upload file to Supabase Storage
    const filePath = `${user.id}/${Date.now()}-${file.name}`;
    await supabase.storage.from("rfq-files").upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

    // 3 — Insert RFQ row
    const rfqCode = generateRfqCode();
    const { data: rfq, error: rfqError } = await supabase
      .from("rfqs")
      .insert({
        user_id:    user.id,
        rfq_code:   rfqCode,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        file_name:  file.name,
        file_url:   filePath,
        file_type:  fileType,
        raw_text:   rawText,
        status:     "processing",
        priority,
      })
      .select("id")
      .single();

    if (rfqError || !rfq) {
      return NextResponse.json({ error: rfqError?.message ?? "DB error" }, { status: 500 });
    }

    // 4 — AI: normalize + categorize items
    const items = await normalizeAndCategorize(rawText);

    // 5 — Insert items
    if (items.length > 0) {
      const rows = items.map((item) => ({
        rfq_id:              rfq.id,
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
      }));

      await supabase.from("rfq_items").insert(rows);
    }

    // 6 — Mark RFQ as processed
    await supabase.from("rfqs").update({ status: "processed" }).eq("id", rfq.id);

    return NextResponse.json({ rfqId: rfq.id, rfqCode, itemCount: items.length });
  } catch (err: unknown) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
