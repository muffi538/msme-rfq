import { NextRequest, NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { parseCsv } from "@/lib/parsers/csv";
import { parseDocx } from "@/lib/parsers/docx";
import { extractTextViaOpenAI } from "@/lib/ai/extractText";
import { normalizeAndCategorizeMulti, type MultiFileInput } from "@/lib/ai/normalize";
import { matchImageToItem } from "@/lib/ai/matchImages";
import { generateRfqCode } from "@/lib/rfq";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob } from "@/lib/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 120;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB per file — comfortably under OpenAI's file-upload limits
const MAX_FILES = 10;

type FileType = "pdf" | "excel" | "csv" | "docx" | "image" | "text";

function detectFileType(filename: string, mime: string): FileType | null {
  const lower = filename.toLowerCase();
  if (mime.includes("pdf") || lower.endsWith(".pdf"))                          return "pdf";
  if (mime.includes("image") || /\.(jpe?g|png|webp|gif)$/.test(lower))         return "image";
  if (lower.endsWith(".docx") || mime.includes("wordprocessingml"))            return "docx";
  if (lower.endsWith(".csv") || mime.includes("text/csv"))                     return "csv";
  if (lower.endsWith(".txt") || mime.includes("text/plain"))                   return "text";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel")) return "excel";
  return null; // unrecognized — reject rather than guessing
}

type ParsedFile = {
  name: string;
  type: FileType;
  buffer: Buffer;
  mime: string;
  text: string;
  error: string | null;
  usedOcr: boolean;
};

// Parses one file into text. Never throws — a failure is recorded on the
// result so the batch can continue with the remaining files (requirement:
// "continue processing remaining files if one fails").
async function parseOneFile(name: string, type: FileType, buffer: Buffer, mime: string): Promise<ParsedFile> {
  const base = { name, type, buffer, mime, text: "", error: null as string | null, usedOcr: false };
  try {
    switch (type) {
      case "pdf": {
        try {
          return { ...base, text: await parsePdf(buffer) };
        } catch {
          // Malformed/scanned PDF — fall back to OpenAI, which handles any PDF via base64
          return { ...base, text: await extractTextViaOpenAI(buffer, "application/pdf"), usedOcr: true };
        }
      }
      case "excel": return { ...base, text: parseExcel(buffer) };
      case "csv":   return { ...base, text: parseCsv(buffer) };
      case "docx":  return { ...base, text: await parseDocx(buffer) };
      case "text":  return { ...base, text: buffer.toString("utf-8") };
      case "image": return { ...base, text: await extractTextViaOpenAI(buffer, mime || "image/jpeg"), usedOcr: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse this file";
    return { ...base, error: `Could not read "${name}": ${msg}` };
  }
}

type ProgressStage = "uploading" | "ocr" | "parsing" | "matching" | "complete";

async function runUploadJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  files: { name: string; type: FileType; mime: string; buffer: Buffer }[],
  buyerName: string | null,
  buyerEmail: string | null,
  priority: string
) {
  const report = (stage: ProgressStage, processed: number, currentFile?: string) =>
    updateJob(supabase, jobId, { status: "running", progress: { stage, processed, total: files.length, currentFile } });

  try {
    // Stage 1: store every file's raw bytes first — independent of parse
    // success, so a file that later fails to parse is still kept.
    await report("uploading", 0);
    const stored: { name: string; path: string | null }[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await report("uploading", i, f.name);
      const path = `${userId}/${Date.now()}-${f.name}`;
      const { error: storageError } = await supabase.storage.from("rfq-files").upload(path, f.buffer, { upsert: false });
      stored.push({ name: f.name, path: storageError ? null : path });
    }

    // Stage 2: extract text — OCR for images (PDFs that need an OCR
    // fallback are relabelled once that path actually triggers).
    const parsed: ParsedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await report(f.type === "image" ? "ocr" : "parsing", i, f.name);
      const result = await parseOneFile(f.name, f.type, f.buffer, f.mime);
      if (result.usedOcr) await report("ocr", i, f.name);
      parsed.push(result);
    }

    const usable = parsed.filter((f) => !f.error && f.text.trim());
    const failed = parsed.filter((f) => f.error);

    if (usable.length === 0) {
      await updateJob(supabase, jobId, {
        status: "failed",
        error: failed.length > 0
          ? `Could not extract any text from the uploaded file(s). ${failed.map((f) => f.error).join(" ")}`
          : "Could not extract any text from the uploaded file(s).",
      });
      return;
    }

    const rfqCode = await generateRfqCode(supabase);
    const first = parsed[0];
    const { data: rfq, error: rfqError } = await supabase
      .from("rfqs")
      .insert({
        user_id:     userId,
        rfq_code:    rfqCode,
        buyer_name:  buyerName,
        buyer_email: buyerEmail,
        file_name:   files.length === 1 ? first.name : `${first.name} (+${files.length - 1} more)`,
        file_url:    stored[0]?.path ?? null,
        file_type:   files.length === 1 ? first.type : "mixed",
        raw_text:    usable.map((f) => f.text).join("\n\n").slice(0, 20000),
        status:      "processing",
        priority,
      })
      .select("id")
      .single();

    if (rfqError || !rfq) {
      await updateJob(supabase, jobId, { status: "failed", error: rfqError?.message ?? "Could not create the RFQ." });
      return;
    }

    await supabase.from("rfq_files").insert(
      parsed.map((f, i) => ({
        rfq_id:    rfq.id,
        user_id:   userId,
        file_name: f.name,
        file_url:  stored[i]?.path ?? null,
        file_type: f.type,
        raw_text:  f.text || null,
        status:    f.error ? "failed" : "parsed",
        error:     f.error,
      }))
    );

    // Merge + extract across every successfully-parsed file
    await report("parsing", files.length);
    const multiInput: MultiFileInput[] = usable.map((f) => ({ fileName: f.name, text: f.text }));
    const { meta, items } = await normalizeAndCategorizeMulti(multiInput);

    const rfqWarnings: string[] = failed.map((f) => f.error!).filter(Boolean);
    if (!meta.source_rfq_number) rfqWarnings.push("No RFQ number was found in the uploaded document(s).");
    if (buyerName && meta.buyer_name && normalizeForCompare(buyerName) !== normalizeForCompare(meta.buyer_name)) {
      rfqWarnings.push(`The document appears to be from "${meta.buyer_name}", but the buyer name entered was "${buyerName}" — please double-check.`);
    }
    if (items.length === 0) rfqWarnings.push("No line items could be extracted — please review the source file(s) manually.");

    let insertedItems: { id: string; name: string; brand: string | null; spec: string | null }[] = [];
    if (items.length > 0) {
      const rows = items.map((item) => ({
        rfq_id:              rfq.id,
        user_id:             userId,
        line_number:         item.line_number,
        raw_text:            item.raw_text,
        name:                item.name,
        qty:                 item.qty,
        unit:                item.unit,
        brand:               item.brand,
        spec:                item.spec,
        notes:               item.notes,
        part_number:         item.part_number,
        delivery_details:    item.delivery_details,
        category:            item.category,
        category_source:     item.category_source,
        category_confidence: item.category_confidence,
        confidence:          item.confidence,
        warnings:            item.warnings,
        merged_from_count:   item.merged_from_count,
        flagged:             item.category_confidence < 0.7 || item.confidence < 0.6,
      }));

      const { data: inserted, error: itemsError } = await supabase.from("rfq_items").insert(rows).select("id, name, brand, spec");
      if (itemsError) {
        logError("[rfqs/upload] rfq_items insert failed", itemsError);
        await updateJob(supabase, jobId, { status: "failed", error: `Could not save extracted items: ${itemsError.message}` });
        return;
      }
      insertedItems = inserted ?? [];
    }

    // Match standalone image files to line items ("preserve image associations")
    await report("matching", files.length);
    const imageFiles = parsed.filter((f) => f.type === "image" && !f.error);
    if (imageFiles.length > 0) {
      const imageRows = imageFiles.map((img) => {
        const storedPath = stored[parsed.indexOf(img)]?.path;
        if (!storedPath) return null;
        const match = matchImageToItem(img.text, insertedItems);
        return {
          rfq_id:           rfq.id,
          item_id:          match?.itemId ?? null,
          user_id:          userId,
          file_url:         storedPath,
          source_file_name: img.name,
          match_confidence: match?.confidence ?? null,
        };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      if (imageRows.length > 0) await supabase.from("rfq_item_images").insert(imageRows);
    }

    await supabase.from("rfqs").update({
      status:             "processed",
      source_rfq_number:  meta.source_rfq_number,
      source_date:        meta.source_date,
      warnings:            rfqWarnings,
    }).eq("id", rfq.id);

    await updateJob(supabase, jobId, {
      status: "done",
      progress: { stage: "complete", processed: files.length, total: files.length },
      result: { rfqId: rfq.id, rfqCode, itemCount: items.length, fileCount: usable.length, failedFiles: failed.map((f) => f.name), warnings: rfqWarnings },
    });
  } catch (err: unknown) {
    logError("[rfqs/upload] job failed", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    await updateJob(supabase, jobId, { status: "failed", error: msg });
  }
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    const incoming  = formData.getAll("file").filter((f): f is File => f instanceof File);
    const buyerName = (formData.get("buyerName") as string) || null;
    const buyerEmailRaw = (formData.get("buyerEmail") as string)?.trim();
    const buyerEmail = buyerEmailRaw || null;
    const priority  = (formData.get("priority") as string) || "normal";

    if (incoming.length === 0) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (incoming.length > MAX_FILES) {
      return NextResponse.json({ error: `Too many files — maximum ${MAX_FILES} per RFQ.` }, { status: 413 });
    }

    const files: { name: string; type: FileType; mime: string; buffer: Buffer }[] = [];
    for (const file of incoming) {
      if (file.size === 0) return NextResponse.json({ error: `"${file.name}" is empty.` }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB per file.` },
          { status: 413 }
        );
      }
      const fileType = detectFileType(file.name, file.type);
      if (!fileType) {
        return NextResponse.json(
          { error: `Unsupported file type "${file.name}". Please upload PDF, Excel (.xlsx/.xls), CSV, Word (.docx), text, or image files.` },
          { status: 415 }
        );
      }
      files.push({ name: file.name, type: fileType, mime: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
    }

    const { job, error: jobError } = await createJob(supabase, user.id, "rfq_upload");
    if (jobError || !job) {
      logError("[rfqs/upload] could not create job", jobError);
      return NextResponse.json({ error: "Could not start processing. Please try again." }, { status: 500 });
    }

    // Runs after this response is sent — the client gets the job id back
    // immediately and polls /api/jobs/[id] for stage progress.
    after(() => runUploadJob(supabase, user.id, job.id, files, buyerName, buyerEmail, priority));

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (err: unknown) {
    logError("Upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
