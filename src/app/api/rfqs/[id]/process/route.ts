import { NextRequest, NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseOneFile, type FileType } from "@/lib/parsers/parseFile";
import { extractTextViaOpenAI } from "@/lib/ai/extractText";
import { normalizeAndCategorizeMulti, type MultiFileInput } from "@/lib/ai/normalize";
import { matchImageToItem } from "@/lib/ai/matchImages";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob, findActiveJobForRfq } from "@/lib/jobs";
import { withRetry } from "@/lib/retry";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 120;

// How many attachments to download/parse/OCR at once, per RFQ. Bounded so
// a many-attachment RFQ doesn't fire dozens of simultaneous OpenAI calls —
// this is on top of, and independent from, the client's own concurrency
// limit across DIFFERENT RFQs in a batch.
const FILE_CONCURRENCY = 3;

type ProgressStage = "found" | "ocr" | "parsing" | "matching" | "complete";
type Attachment = { name: string; type: FileType; text: string; error: string | null; fileRowId: string | null };

// The Gmail import used to only capture the FIRST attachment's text and
// silently drop the rest. Attachments are now stored (unparsed) as
// rfq_files rows at fetch time — this job parses every one of them,
// merges + dedupes across all of them, and reports real per-attachment
// progress instead of blocking on one request.
async function runProcessJob(supabase: SupabaseClient, userId: string, jobId: string, rfqId: string) {
  const report = (stage: ProgressStage, processed: number, total: number, currentFile?: string) =>
    updateJob(supabase, jobId, { status: "running", progress: { stage, processed, total, currentFile } });

  // Every failure exit needs to leave the RFQ in a real 'failed' state
  // (with the reason recorded) instead of the old behavior of silently
  // reverting to 'pending' — which made a failed run indistinguishable
  // from one that was never attempted, and gave "Retry Failed" nothing
  // to show the user.
  async function fail(message: string) {
    await supabase.from("rfqs").update({ status: "failed", process_error: message }).eq("id", rfqId);
    await updateJob(supabase, jobId, { status: "failed", error: message });
  }

  try {
    const { data: rfq } = await supabase.from("rfqs").select("id, raw_text, file_type, file_name, buyer_name").eq("id", rfqId).single();
    if (!rfq) { await updateJob(supabase, jobId, { status: "failed", error: "RFQ not found" }); return; }

    const { data: fileRows } = await supabase
      .from("rfq_files")
      .select("id, file_name, file_url, file_type, raw_text, status, error")
      .eq("rfq_id", rfqId)
      .order("created_at");

    await supabase.from("rfqs").update({ status: "processing", process_error: null }).eq("id", rfqId);

    let attachments: Attachment[];

    if (fileRows && fileRows.length > 0) {
      await report("found", 0, fileRows.length);
      let completed = 0;

      attachments = await mapWithConcurrency(
        fileRows,
        FILE_CONCURRENCY,
        async (row): Promise<Attachment> => {
          const type = row.file_type as FileType;

          // Already parsed on an earlier "Process it" click (re-processing
          // an RFQ shouldn't re-run OCR/parsing on files that already succeeded).
          if (row.status === "parsed" && row.raw_text) {
            return { name: row.file_name, type, text: row.raw_text, error: null, fileRowId: row.id };
          }
          if (row.status === "failed") {
            return { name: row.file_name, type, text: "", error: row.error ?? "Previously failed to parse", fileRowId: row.id };
          }
          if (!row.file_url) {
            return { name: row.file_name, type, text: "", error: `Could not find the stored file for "${row.file_name}"`, fileRowId: row.id };
          }

          try {
            const buffer = await withRetry(
              async () => {
                const { data: blob, error: downloadError } = await supabase.storage.from("rfq-files").download(row.file_url!);
                if (downloadError || !blob) throw new Error(`Could not download "${row.file_name}" from storage`);
                return Buffer.from(await blob.arrayBuffer());
              },
              { retries: 2, label: `download "${row.file_name}"` }
            );

            const parsed = await parseOneFile(row.file_name, type, buffer, "");
            await withRetry(
              async () => {
                const { error: updateError } = await supabase.from("rfq_files").update({
                  status:   parsed.error ? "failed" : "parsed",
                  raw_text: parsed.text || null,
                  error:    parsed.error,
                }).eq("id", row.id);
                if (updateError) throw updateError;
              },
              { retries: 2, label: `rfq_files update for "${row.file_name}"` }
            ).catch((err) => logError("[rfqs/process] rfq_files status update failed (non-fatal)", err));

            return { name: row.file_name, type, text: parsed.text, error: parsed.error, fileRowId: row.id };
          } catch (err) {
            const message = err instanceof Error ? err.message : `Could not read "${row.file_name}"`;
            await supabase.from("rfq_files").update({ status: "failed", error: message }).eq("id", row.id);
            return { name: row.file_name, type, text: "", error: message, fileRowId: row.id };
          }
        },
        () => {
          completed++;
          report(fileRows.some((r) => r.file_type === "image") ? "ocr" : "parsing", completed, fileRows.length);
        }
      );
    } else {
      // Legacy single-blob RFQ (fetched before rfq_files existed, or a
      // manually-created one with no attachment rows) — synthesize one
      // pseudo-attachment from rfqs.raw_text so the rest of the pipeline
      // is identical either way.
      await report("found", 0, 1);
      let rawText = (rfq.raw_text ?? "").trim();
      let error: string | null = null;

      if (rawText.startsWith("base64pdf:")) {
        await report("parsing", 0, 1, rfq.file_name ?? undefined);
        const buffer = Buffer.from(rawText.slice("base64pdf:".length), "base64");
        try {
          rawText = await parsePdf(buffer);
        } catch {
          try {
            await report("ocr", 0, 1, rfq.file_name ?? undefined);
            rawText = await withRetry(() => extractTextViaOpenAI(buffer, "application/pdf"), { retries: 2, label: "legacy PDF OCR" });
          } catch (err) {
            rawText = "";
            error = err instanceof Error ? err.message : "Could not parse this PDF";
          }
        }
      } else if (rawText.startsWith("base64img:")) {
        await report("ocr", 0, 1, rfq.file_name ?? undefined);
        // Format is exactly "base64img:<mimeType>:<base64>" — base64's own
        // alphabet never contains ":", so a plain 3-way split is safe.
        const [, mimeType, base64] = rawText.split(":", 3);
        const buffer = Buffer.from(base64 ?? "", "base64");
        try {
          rawText = await withRetry(() => extractTextViaOpenAI(buffer, mimeType || "image/jpeg"), { retries: 2, label: "legacy image OCR" });
        } catch (err) {
          rawText = "";
          error = err instanceof Error ? err.message : "Could not read this image";
        }
      } else {
        await report("parsing", 0, 1, rfq.file_name ?? undefined);
      }

      if (!rawText.trim() && !error) error = "No text could be extracted from this email.";
      attachments = [{ name: rfq.file_name ?? "attachment", type: (rfq.file_type as FileType) ?? "text", text: rawText, error, fileRowId: null }];
    }

    const usable = attachments.filter((a) => !a.error && a.text.trim());
    const failed = attachments.filter((a) => a.error);

    if (usable.length === 0) {
      await fail(
        failed.length > 0
          ? `Could not extract any text from the attachment(s). ${failed.map((f) => f.error).join(" ")}`
          : "No text could be extracted from this email. Please upload the file manually via Upload RFQ."
      );
      return;
    }

    await report("parsing", attachments.length, attachments.length);
    const multiInput: MultiFileInput[] = usable.map((a) => ({ fileName: a.name, text: a.text }));
    const { meta, items } = await withRetry(
      () => normalizeAndCategorizeMulti(multiInput),
      { retries: 1, label: "AI item extraction" } // normalizeAndCategorizeMulti already retries its own OpenAI call; this covers a second, coarser layer (e.g. a transient DB hiccup wouldn't apply here, so kept small)
    );

    const rfqWarnings: string[] = failed.map((f) => `Could not read "${f.name}": ${f.error}`);
    if (items.length === 0) rfqWarnings.push("No line items could be extracted — please review the source file(s) manually.");

    // Re-processing: clear whatever a previous run produced.
    await supabase.from("rfq_items").delete().eq("rfq_id", rfqId);
    await supabase.from("rfq_item_images").delete().eq("rfq_id", rfqId);

    let insertedItems: { id: string; name: string; brand: string | null; spec: string | null }[] = [];
    if (items.length > 0) {
      const rows = items.map((item) => ({
        rfq_id:              rfqId,
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
        source_files:        item.source_files,
        flagged:             item.category_confidence < 0.7 || item.confidence < 0.6,
      }));

      try {
        const inserted = await withRetry(
          async () => {
            const { data, error: itemsError } = await supabase.from("rfq_items").insert(rows).select("id, name, brand, spec");
            if (itemsError) throw itemsError;
            return data;
          },
          { retries: 2, label: "rfq_items insert" }
        );
        insertedItems = inserted ?? [];
      } catch (err) {
        logError("[rfqs/process] rfq_items insert failed", err);
        await fail(`Could not save extracted items: ${err instanceof Error ? err.message : "unknown error"}`);
        return;
      }
    }

    await report("matching", attachments.length, attachments.length);
    const imageAttachments = attachments.filter((a) => a.type === "image" && !a.error && a.fileRowId);
    if (imageAttachments.length > 0) {
      // Reuse fileRows (already fetched above) instead of re-querying —
      // it already has every file_url keyed by id.
      const urlById = new Map((fileRows ?? []).map((r) => [r.id, r.file_url]));

      const imageRows = imageAttachments.map((a) => {
        const storedPath = urlById.get(a.fileRowId!);
        if (!storedPath) return null;
        const match = matchImageToItem(a.text, insertedItems);
        return {
          rfq_id:           rfqId,
          item_id:          match?.itemId ?? null,
          user_id:          userId,
          file_url:         storedPath,
          source_file_name: a.name,
          match_confidence: match?.confidence ?? null,
        };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      if (imageRows.length > 0) await supabase.from("rfq_item_images").insert(imageRows);
    }

    await supabase.from("rfqs").update({
      status:            "processed",
      process_error:      null,
      source_rfq_number: meta.source_rfq_number,
      source_date:        meta.source_date,
      warnings:           rfqWarnings,
    }).eq("id", rfqId);

    await updateJob(supabase, jobId, {
      status: "done",
      progress: { stage: "complete", processed: attachments.length, total: attachments.length },
      result: {
        itemCount:      items.length,
        foundCount:     attachments.length,
        processedCount: usable.length,
        failedFiles:    failed.map((f) => f.name),
        warnings:       rfqWarnings,
      },
    });
  } catch (err: unknown) {
    logError("[rfqs/process] job failed", err);
    await fail(err instanceof Error ? err.message : "Internal error");
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const allowed = await checkRateLimit(supabase, user.id, "rfq-process", 600, 300);
  if (!allowed) {
    return NextResponse.json({ error: "Too many processing requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  const { data: rfq } = await supabase.from("rfqs").select("id, status, updated_at").eq("id", id).maybeSingle();
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  // Idempotency guard — if this RFQ already has a job in flight (a
  // double-click, two tabs on the same row, or now that RFQs are shared
  // company data, a DIFFERENT user hitting "Process it" on a row someone
  // else already started), don't kick off a second concurrent run that
  // would race the first one writing rfq_items for the same RFQ.
  //
  // The jobs table stays per-user (RLS), so this user's own query can only
  // ever find THEIR OWN active job — it can't see another user's job row
  // to hand back. rfqs.status is shared, though, so that's the signal of
  // record: if it says "processing" and this user has no matching job of
  // their own, someone else's run is in flight — refuse rather than guess.
  if (rfq.status === "processing") {
    const active = await findActiveJobForRfq(supabase, user.id, id);
    if (active) return NextResponse.json({ jobId: active.id }, { status: 202 });

    // Escape hatch for a genuinely orphaned run (the process crashed or the
    // function was killed without ever reaching a terminal status) — after
    // a long stretch with no update at all, treat it as abandoned instead
    // of blocking this RFQ from ever being retried again.
    const STALE_MS = 10 * 60 * 1000;
    const staleMs = rfq.updated_at ? Date.now() - new Date(rfq.updated_at).getTime() : Infinity;
    if (staleMs < STALE_MS) {
      return NextResponse.json(
        { error: "This RFQ is already being processed — possibly by another user. Please wait a few minutes and try again." },
        { status: 409 }
      );
    }
    logError("[rfqs/process] resuming a stale 'processing' RFQ with no active job found", { rfqId: id, staleMs });
  }

  const { job, error: jobError } = await createJob(supabase, user.id, "rfq_process", id);
  if (jobError || !job) {
    logError("[rfqs/process] could not create job", jobError);
    return NextResponse.json({ error: "Could not start processing. Please try again." }, { status: 500 });
  }

  after(() => runProcessJob(supabase, user.id, job.id, id));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
