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
const ITEM_INSERT_CHUNK = 25; // items per insert batch — one round trip for typical RFQs, real parallel progress for large ones

// Every stage here corresponds to real work the job actually does — no
// stage is entered, and no percent is reported, without a genuine
// completion signal behind it (never a timer). "categorize" is the one
// stage with no separate network call of its own: normalizeAndCategorizeMulti
// returns already-categorized items in one response, so this stage exists
// purely as a real checkpoint the instant that response is parsed, not as
// separate work — kept as its own stage because the category assignment IS
// a distinct, observable fact about the response at that point, not a
// fabricated delay.
type StageId = "download" | "parse" | "ocr" | "extract_items" | "categorize" | "match_images" | "save" | "complete";
const BASE_WEIGHT: Record<StageId, number> = {
  download: 5, parse: 15, ocr: 20, extract_items: 30, categorize: 5, match_images: 10, save: 10, complete: 5,
};
const STAGE_LABEL: Record<StageId, string> = {
  download:      "Downloading",
  parse:         "Parsing",
  ocr:           "Running OCR",
  extract_items: "Extracting items",
  categorize:    "Categorizing",
  match_images:  "Matching images",
  save:          "Saving",
  complete:      "Complete",
};

// Some stages don't apply to every RFQ (no OCR needed if there are no
// images; no image matching if there are no images at all) — excluding
// them from the weight total means the ones that DO run get the freed-up
// weight, so percent still moves smoothly across the stages that actually
// execute instead of visibly jumping over a stage that was skipped.
function makePercentCalculator(activeStages: StageId[]) {
  const totalWeight = activeStages.reduce((s, id) => s + BASE_WEIGHT[id], 0);
  const cumBefore = new Map<StageId, number>();
  let running = 0;
  for (const id of activeStages) { cumBefore.set(id, running); running += BASE_WEIGHT[id]; }
  return (stage: StageId, processed: number, total: number): number => {
    const before = cumBefore.get(stage) ?? running; // unknown/inactive stage — treat as "past everything counted"
    const frac = total > 0 ? Math.min(1, Math.max(0, processed / total)) : (stage === "complete" ? 1 : 0);
    const weight = BASE_WEIGHT[stage] ?? 0;
    return Math.min(100, Math.round(((before + weight * frac) / totalWeight) * 100));
  };
}

type Attachment = { name: string; type: FileType; text: string; error: string | null; fileRowId: string | null };

// The Gmail import used to only capture the FIRST attachment's text and
// silently drop the rest. Attachments are now stored (unparsed) as
// rfq_files rows at fetch time — this job parses every one of them,
// merges + dedupes across all of them, and reports real per-attachment
// progress instead of blocking on one request.
async function runProcessJob(supabase: SupabaseClient, userId: string, jobId: string, rfqId: string) {
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
    let activeStages: StageId[];

    if (fileRows && fileRows.length > 0) {
      const hasImages = fileRows.some((r) => r.file_type === "image");
      // Known upfront from stored file_type; a PDF that unexpectedly falls
      // back to OCR mid-parse still gets OCR'd correctly, it just doesn't
      // get its own separately-weighted stage since that can't be known
      // before parsing starts.
      const needsOcr = hasImages;
      // Order matches actual execution order below, not the checklist order
      // in the UI copy — image matching needs insertedItems, so items must
      // be saved first. Getting this backwards would make percent briefly
      // go backwards when "save" runs after a stage the weight table
      // thought came later.
      activeStages = (["download", "parse", needsOcr ? "ocr" : null, "extract_items", "categorize", "save", hasImages ? "match_images" : null, "complete"] as (StageId | null)[])
        .filter((s): s is StageId => s !== null);
      const percentFor = makePercentCalculator(activeStages);
      const report = (stage: StageId, processed: number, total: number, currentFile?: string) =>
        updateJob(supabase, jobId, {
          status: "running",
          progress: { stage, label: STAGE_LABEL[stage], processed, total, currentFile, percent: percentFor(stage, processed, total) },
        });

      await report("download", 0, fileRows.length);
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
          report(needsOcr ? "ocr" : "parse", completed, fileRows.length);
        }
      );

      await runRest(report, activeStages, fileRows);
    } else {
      // Legacy single-blob RFQ (fetched before rfq_files existed, or a
      // manually-created one with no attachment rows) — synthesize one
      // pseudo-attachment from rfqs.raw_text so the rest of the pipeline
      // is identical either way.
      const isImage = rfq.raw_text?.startsWith("base64img:") ?? false;
      const isPdf   = rfq.raw_text?.startsWith("base64pdf:") ?? false;
      activeStages = (["download", isImage ? "ocr" : "parse", "extract_items", "categorize", "save", "complete"] as StageId[]);
      const percentFor = makePercentCalculator(activeStages);
      const report = (stage: StageId, processed: number, total: number, currentFile?: string) =>
        updateJob(supabase, jobId, {
          status: "running",
          progress: { stage, label: STAGE_LABEL[stage], processed, total, currentFile, percent: percentFor(stage, processed, total) },
        });

      await report("download", 0, 1);
      let rawText = (rfq.raw_text ?? "").trim();
      let error: string | null = null;

      if (isPdf) {
        await report("parse", 0, 1, rfq.file_name ?? undefined);
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
      } else if (isImage) {
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
        await report("parse", 0, 1, rfq.file_name ?? undefined);
      }

      if (!rawText.trim() && !error) error = "No text could be extracted from this email.";
      attachments = [{ name: rfq.file_name ?? "attachment", type: (rfq.file_type as FileType) ?? "text", text: rawText, error, fileRowId: null }];

      await runRest(report, activeStages, fileRows);
    }

    // --- shared tail: extract → categorize → match images → save → complete ---
    async function runRest(
      report: (stage: StageId, processed: number, total: number, currentFile?: string) => Promise<void>,
      stages: StageId[],
      fileRowsForMatching: typeof fileRows
    ) {
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

      await report("extract_items", 0, 1);
      const multiInput: MultiFileInput[] = usable.map((a) => ({ fileName: a.name, text: a.text }));
      const { meta, items } = await withRetry(
        () => normalizeAndCategorizeMulti(multiInput),
        { retries: 1, label: "AI item extraction" } // normalizeAndCategorizeMulti already retries its own OpenAI call; this covers a second, coarser layer
      );
      await report("extract_items", 1, 1);
      // Categories arrive already assigned in the same response above — this
      // is a real checkpoint (the categorized item set now genuinely
      // exists), not a separate wait.
      await report("categorize", items.length, items.length || 1);

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

        // Chunked + concurrent — for a typical RFQ (<= ITEM_INSERT_CHUNK
        // items) this is exactly one insert, identical cost to before; for
        // a large RFQ it's genuinely faster (parallel round trips) AND
        // gives real "Items X/Y" progress instead of one opaque insert.
        const chunks: (typeof rows)[] = [];
        for (let i = 0; i < rows.length; i += ITEM_INSERT_CHUNK) chunks.push(rows.slice(i, i + ITEM_INSERT_CHUNK));

        let savedCount = 0;
        try {
          const chunkResults = await mapWithConcurrency(
            chunks,
            3,
            (chunk) => withRetry(
              async () => {
                const { data, error: itemsError } = await supabase.from("rfq_items").insert(chunk).select("id, name, brand, spec");
                if (itemsError) throw itemsError;
                return data ?? [];
              },
              { retries: 2, label: "rfq_items insert" }
            ),
            (result) => { savedCount += result.length; report("save", savedCount, rows.length); }
          );
          insertedItems = chunkResults.flat();
        } catch (err) {
          logError("[rfqs/process] rfq_items insert failed", err);
          await fail(`Could not save extracted items: ${err instanceof Error ? err.message : "unknown error"}`);
          return;
        }
      } else {
        await report("save", 1, 1); // nothing to insert — stage is trivially complete
      }

      if (stages.includes("match_images")) {
        const imageAttachments = attachments.filter((a) => a.type === "image" && !a.error && a.fileRowId);
        await report("match_images", 0, Math.max(imageAttachments.length, 1));
        if (imageAttachments.length > 0) {
          // Reuse fileRows (already fetched above) instead of re-querying —
          // it already has every file_url keyed by id.
          const urlById = new Map((fileRowsForMatching ?? []).map((r) => [r.id, r.file_url]));

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
        await report("match_images", imageAttachments.length, Math.max(imageAttachments.length, 1));
      }

      await supabase.from("rfqs").update({
        status:            "processed",
        process_error:      null,
        source_rfq_number: meta.source_rfq_number,
        source_date:        meta.source_date,
        warnings:           rfqWarnings,
      }).eq("id", rfqId);

      await report("complete", 1, 1);
      await updateJob(supabase, jobId, {
        status: "done",
        progress: { stage: "complete", label: STAGE_LABEL.complete, processed: 1, total: 1, percent: 100 },
        result: {
          itemCount:      items.length,
          foundCount:     attachments.length,
          processedCount: usable.length,
          failedFiles:    failed.map((f) => f.name),
          warnings:       rfqWarnings,
        },
      });
    }
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
  // double-click, or two tabs on the same row), don't kick off a second
  // concurrent run that would race the first one writing rfq_items for the
  // same RFQ. RFQs are strictly per-account (RLS), so this can only ever be
  // this same user's own in-flight run — never another account's.
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
        { error: "This RFQ is already being processed. Please wait a few minutes and try again." },
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
