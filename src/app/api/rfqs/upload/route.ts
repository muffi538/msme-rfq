import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { normalizeAndCategorize } from "@/lib/ai/normalize";
import { generateRfqCode } from "@/lib/rfq";
import { checkRateLimit } from "@/lib/rateLimit";

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
    signal: AbortSignal.timeout(45000),
  });
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — comfortably under OpenAI's file-upload limits

function detectFileType(filename: string, mime: string): "pdf" | "excel" | "image" | "text" | null {
  const lower = filename.toLowerCase();
  if (mime.includes("pdf") || lower.endsWith(".pdf"))                          return "pdf";
  if (mime.includes("image") || /\.(jpe?g|png|webp|gif)$/.test(lower))         return "image";
  if (lower.endsWith(".txt") || lower.endsWith(".csv") || mime.includes("text/plain") || mime.includes("text/csv")) return "text";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel")) return "excel";
  return null; // unrecognized — reject rather than guessing
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    // Each upload triggers OpenAI calls (real cost) — cap how often it can run.
    const allowed = await checkRateLimit(supabase, user.id, "rfq-upload", 600, 20);
    if (!allowed) {
      return NextResponse.json({ error: "Too many uploads. Please wait a few minutes and try again." }, { status: 429 });
    }

    const formData  = await request.formData();
    const file      = formData.get("file") as File | null;
    const buyerName = (formData.get("buyerName") as string) || null;
    const buyerEmailRaw = (formData.get("buyerEmail") as string)?.trim();
    const buyerEmail = buyerEmailRaw || null;
    const priority  = (formData.get("priority") as string) || "normal";

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty." }, { status: 400 });
    }

    const fileType = detectFileType(file.name, file.type);
    if (!fileType) {
      return NextResponse.json(
        { error: `Unsupported file type "${file.name}". Please upload a PDF, Excel (.xlsx/.xls), image, or text/CSV file.` },
        { status: 415 }
      );
    }

    const bytes  = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

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
    const { error: storageError } = await supabase.storage.from("rfq-files").upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    });
    if (storageError) {
      logError("[rfqs/upload] storage upload failed", storageError);
      return NextResponse.json({ error: `File upload failed: ${storageError.message}` }, { status: 500 });
    }

    // 3 — Insert RFQ row
    const rfqCode = await generateRfqCode(supabase);
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

      const { error: itemsError } = await supabase.from("rfq_items").insert(rows);
      if (itemsError) {
        logError("[rfqs/upload] rfq_items insert failed", itemsError);
        return NextResponse.json({ error: `Could not save extracted items: ${itemsError.message}` }, { status: 500 });
      }
    }

    // 6 — Mark RFQ as processed
    const { error: statusError } = await supabase.from("rfqs").update({ status: "processed" }).eq("id", rfq.id);
    if (statusError) logError("[rfqs/upload] status update failed", statusError);

    return NextResponse.json({ rfqId: rfq.id, rfqCode, itemCount: items.length });
  } catch (err: unknown) {
    logError("Upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
