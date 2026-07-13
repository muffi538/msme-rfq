import { withRetry } from "@/lib/retry";
import { logError } from "@/lib/logError";
import { mapWithConcurrency } from "@/lib/concurrency";

export type RawItem = {
  line_number: number;
  raw_text: string;
  name: string;
  qty: number | null;
  unit: string | null;
  brand: string | null;
  spec: string | null;
  notes: string | null;
};

const CATEGORIES = [
  "POWER_TOOLS","HAND_TOOLS","FURNITURE_FITTINGS","SAFETY_ITEMS",
  "FASTENERS","SANITARY_PLUMBING","PAINTS","VALVES_FITTINGS",
  "PACKAGING_MATERIALS","ELECTRICAL","HVAC","GENERAL_HARDWARE",
] as const;

export type Category = typeof CATEGORIES[number];

export type CategorisedItem = RawItem & {
  category: Category;
  category_source: "llm";
  category_confidence: number;
};

export async function normalizeAndCategorize(rawText: string): Promise<CategorisedItem[]> {
  // Truncate to keep API call fast (50-item RFQ ≈ 3000 chars)
  const text = rawText.slice(0, 6000);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a procurement assistant. Extract RFQ line items and return ONLY valid JSON with key 'items' as an array.",
        },
        {
          role: "user",
          content: `Extract all line items from this RFQ. Return JSON: {"items":[{"n":1,"name":"item name","qty":5,"unit":"pcs","brand":null,"spec":null,"cat":"POWER_TOOLS","conf":0.9},...]}

Categories: POWER_TOOLS, HAND_TOOLS, FURNITURE_FITTINGS, SAFETY_ITEMS, FASTENERS, SANITARY_PLUMBING, PAINTS, VALVES_FITTINGS, PACKAGING_MATERIALS, ELECTRICAL, HVAC, GENERAL_HARDWARE

Rules: skip headers/totals. Normalize Hindi to English. SS=Stainless Steel, GI=Galvanized Iron, MS=Mild Steel. qty=null if missing.

RFQ:
${text}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const json = await res.json() as { choices?: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");

  let parsed: { items?: unknown[] };
  try {
    parsed = JSON.parse(content) as { items?: unknown[] };
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const raw = parsed.items ?? [];

  return (raw as Record<string, unknown>[]).map((item, i) => ({
    line_number:         Number(item.n ?? item.line_number ?? i + 1),
    raw_text:            String(item.name ?? ""),
    name:                String(item.name ?? ""),
    qty:                 item.qty != null ? Number(item.qty) : null,
    unit:                item.unit ? String(item.unit) : null,
    brand:               item.brand ? String(item.brand) : null,
    spec:                item.spec ? String(item.spec) : null,
    notes:               null,
    category:            (CATEGORIES.includes(item.cat as Category) ? item.cat : "GENERAL_HARDWARE") as Category,
    category_source:     "llm" as const,
    category_confidence: Number(item.conf ?? 0.8),
  }));
}

// =============================================================
// Multi-file extraction — used by the universal document parser upload
// flow (multiple PDFs/Excel/CSV/DOCX/TXT/images merged into one RFQ).
// Deliberately a separate function: normalizeAndCategorize() above is left
// completely untouched so the existing single-file/email-derived pipeline
// keeps behaving exactly as it does today.
// =============================================================

export type MultiFileInput = { fileName: string; text: string };

export type RfqMeta = {
  source_rfq_number: string | null;
  buyer_name:        string | null;
  source_date:       string | null;
};

export type MergedItem = CategorisedItem & {
  part_number:       string | null;
  delivery_details:  string | null;
  confidence:        number;   // overall extraction confidence, distinct from category_confidence
  warnings:          string[];
  merged_from_count: number;
  source_files:      string[]; // which uploaded/attached file(s) this item was found in
};

const MAX_COMBINED_CHARS = 16000; // ~4k tokens of input text across all files, bounded for cost/latency

function normalizeKey(name: string, brand: string | null): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${(brand ?? "").trim().toLowerCase()}`;
}

// Groups items that are almost certainly the same line repeated across
// source files (e.g. the same RFQ attached as both a PDF and an Excel
// export) and collapses each group to a single row — this is what makes
// "merge into one RFQ" not produce duplicate line items. Matching is by
// normalized name + brand, not semantic similarity, so genuinely distinct
// items with different wording won't be merged (documented limitation).
function dedupeItems(items: MergedItem[]): MergedItem[] {
  const groups = new Map<string, MergedItem[]>();
  for (const item of items) {
    const key = normalizeKey(item.name, item.brand);
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }

  const result: MergedItem[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { result.push(group[0]); continue; }

    // Keep the highest-confidence occurrence as the base row.
    const sorted = [...group].sort((a, b) => b.confidence - a.confidence);
    const kept = { ...sorted[0] };
    kept.merged_from_count = group.length;

    const qtys  = [...new Set(group.map((i) => i.qty).filter((q) => q != null))];
    const specs = [...new Set(group.map((i) => (i.spec ?? "").trim()).filter(Boolean))];
    const warnings = [...kept.warnings];
    if (qtys.length > 1) warnings.push(`Quantity varies across source files (${qtys.join(" vs ")}) — used ${kept.qty}. Please verify.`);
    if (specs.length > 1) warnings.push(`Spec varies across source files — used "${kept.spec}". Please verify against the other source(s).`);
    kept.warnings = warnings;
    kept.source_files = [...new Set(group.flatMap((i) => i.source_files))];

    result.push(kept);
  }

  return result.sort((a, b) => a.line_number - b.line_number);
}

// OpenAI's own transient failures (429 rate limit, 5xx) are worth retrying;
// a 4xx like a bad API key or malformed request will fail identically on
// every retry, so don't waste time/attempts on those.
class OpenAiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Malformed JSON from the model — usually the response got cut off mid-
// object because it hit max_tokens on an unusually large RFQ, or (rarer)
// the model just produced something invalid despite response_format:
// json_object. Distinct from OpenAiError because this reaches the OpenAI
// API successfully (not a 429/5xx) but the CONTENT is unusable — worth one
// retry (a fresh generation is not guaranteed to truncate at the same
// point, and often doesn't), but not worth burning the full retry budget
// on, since a genuinely oversized RFQ will likely truncate again.
class InvalidAiJsonError extends Error {}

// The only error type this module ever lets escape to a caller that shows
// messages to end users. `message` (the Error's own message, via `super`)
// is always safe, generic, non-technical copy — the full technical detail
// (which can include a raw OpenAI response body, HTTP status, etc., and is
// never meant for a customer to see) goes only to `detail`, which callers
// must route through logError, never through user-facing UI.
export class AiExtractionError extends Error {
  constructor(message: string, public detail: string) { super(message); }
}

type RawExtractionResponse = { rfq_number?: unknown; supplier?: unknown; date?: unknown; items?: unknown[] };

// Root-cause fix for "AI returned invalid JSON" / "response wasn't the
// expected shape" on inputs that AREN'T truncated (ruled that out — this
// schema is stricter than what response_format: json_object could ever
// guarantee). json_object mode only guarantees *some* well-formed JSON; it
// does not constrain WHICH shape, so the model is still free to omit
// "items", nest it differently, or return a bare array despite the prompt
// instructions — any of those already-valid-JSON deviations were
// previously reaching JSON.parse() successfully and only failing at the
// separate manual shape-validation step afterward, indistinguishable from
// a genuine parse failure. OpenAI's Structured Outputs (json_schema,
// strict: true) constrains the model's token-level generation itself, so
// it is structurally incapable of producing anything but this exact
// shape — eliminating this whole class of failure at the source instead
// of reactively validating/repairing after the fact. Every field must be
// listed in "required" per strict mode's rules (nullability is expressed
// via a ["type","null"] union, not by omitting the key).
const EXTRACTION_JSON_SCHEMA = {
  name: "rfq_extraction",
  strict: true,
  schema: {
    type: "object",
    properties: {
      rfq_number: { type: ["string", "null"] },
      supplier:   { type: ["string", "null"] },
      date:       { type: ["string", "null"] },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n:        { type: "integer" },
            name:     { type: "string" },
            qty:      { type: ["number", "null"] },
            unit:     { type: ["string", "null"] },
            brand:    { type: ["string", "null"] },
            spec:     { type: ["string", "null"] },
            part:     { type: ["string", "null"] },
            delivery: { type: ["string", "null"] },
            cat:      { type: "string", enum: [...CATEGORIES] },
            conf:     { type: "number" },
            file:     { type: "string" },
          },
          required: ["n", "name", "qty", "unit", "brand", "spec", "part", "delivery", "cat", "conf", "file"],
          additionalProperties: false,
        },
      },
    },
    required: ["rfq_number", "supplier", "date", "items"],
    additionalProperties: false,
  },
} as const;

// Scans a JSON array's inner content and returns the source text of every
// TOP-LEVEL object that closed cleanly, ignoring braces/brackets/commas
// that appear inside string values (tracked via a proper in-string/escape
// state machine, not a naive bracket count). A trailing partial object —
// the one the model was still writing when it got cut off — is simply
// never pushed, since its closing "}" never arrives.
function extractBalancedObjects(arrayContent: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < arrayContent.length; i++) {
    const c = arrayContent[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(arrayContent.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

// Root-cause fix for "AI returned invalid JSON": the dominant real cause
// (confirmed via production logs of the raw content) is the model hitting
// max_tokens mid-object on a large multi-file RFQ — response_format:
// json_object guarantees well-formed JSON only when generation completes
// normally, not when it's truncated. Rather than discarding an otherwise
// mostly-complete extraction, salvage every fully-closed item object plus
// whatever header fields (rfq_number/supplier/date) are recoverable, and
// drop only the one partial item that was mid-flight when the cutoff hit.
// Returns null (never a fabricated empty success) when nothing is
// salvageable, so the caller still fails cleanly in that case.
function tryRepairTruncatedJson(content: string): RawExtractionResponse | null {
  const itemsKeyMatch = content.match(/"items"\s*:\s*\[/);
  if (!itemsKeyMatch || itemsKeyMatch.index === undefined) return null;

  const arrayStart = itemsKeyMatch.index + itemsKeyMatch[0].length;
  const objectStrings = extractBalancedObjects(content.slice(arrayStart));
  if (objectStrings.length === 0) return null;

  const items: unknown[] = [];
  for (const objStr of objectStrings) {
    try { items.push(JSON.parse(objStr)); } catch { /* skip the one malformed/truncated object */ }
  }
  if (items.length === 0) return null;

  const safeParse = (s: string | undefined): unknown => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  return {
    rfq_number: safeParse(content.match(/"rfq_number"\s*:\s*("(?:[^"\\]|\\.)*"|null)/)?.[1]),
    supplier:   safeParse(content.match(/"supplier"\s*:\s*("(?:[^"\\]|\\.)*"|null)/)?.[1]),
    date:       safeParse(content.match(/"date"\s*:\s*("(?:[^"\\]|\\.)*"|null)/)?.[1]),
    items,
  };
}

async function callAndParseOnce(labeled: string): Promise<{ data: RawExtractionResponse; truncated: boolean }> {
  const callStartedAt = Date.now();
  console.log(`[normalize] START AI chars=${labeled.length}`);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 8000, // bumped from 4000 — a large multi-file RFQ (many line items) could hit the old cap mid-object, producing truncated/invalid JSON
        // json_schema + strict:true (Structured Outputs) instead of the
        // weaker json_object mode — constrains generation itself so the
        // model cannot produce a malformed or wrong-shaped response, not
        // just "some valid JSON" that still needs shape-validating after.
        response_format: { type: "json_schema", json_schema: EXTRACTION_JSON_SCHEMA },
        messages: [
          {
            role: "system",
            content: "You are a procurement assistant. Multiple source files (possibly duplicating each other) describe ONE request for quotation. Extract RFQ-level metadata plus every line item and return ONLY valid JSON.",
          },
          {
            role: "user",
            content: `Return JSON:
{"rfq_number": "..." or null, "supplier": "..." or null, "date": "..." or null,
 "items": [{"n":1,"name":"item name","qty":5,"unit":"pcs","brand":null,"spec":null,"part":null,"delivery":null,"cat":"POWER_TOOLS","conf":0.9,"file":"exact FILE name this item came from"},...]}

Categories: POWER_TOOLS, HAND_TOOLS, FURNITURE_FITTINGS, SAFETY_ITEMS, FASTENERS, SANITARY_PLUMBING, PAINTS, VALVES_FITTINGS, PACKAGING_MATERIALS, ELECTRICAL, HVAC, GENERAL_HARDWARE

Field meanings: "supplier" = whoever authored/sent this RFQ document (their company name, if stated). "part" = part number / SKU / model code, if printed. "delivery" = any delivery location, date, or lead-time text tied to that item or the whole order. "conf" = your confidence (0-1) in the overall accuracy of that item's extracted fields, not just its category. "file" = copy the exact name from the "--- FILE: ... ---" heading this item was found under.

Rules: skip headers/totals/page numbers. If the same item is described in more than one FILE section, still list it once per FILE section — a later merge step deduplicates. Normalize Hindi to English. SS=Stainless Steel, GI=Galvanized Iron, MS=Mild Steel. qty=null if missing.

SOURCE FILES:
${labeled}`,
          },
        ],
      }),
      // Chunking (see chunkLabeledText below) keeps any single call's
      // expected output small, so this budget is now sized for a normal
      // chunk-sized response rather than a whole large RFQ at once.
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    // Covers AbortSignal.timeout() firing (a bare DOMException, not an
    // HTTP response) and genuine network failures (DNS, connection reset)
    // — neither reaches the res.ok check below, so without this the
    // duration/size context would be lost the moment this throws.
    const name = err instanceof Error ? err.name : "Error";
    console.log(`[normalize] AI FAILED (${name}) chars=${labeled.length} after ${Date.now() - callStartedAt}ms`);
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    console.log(`[normalize] AI FAILED chars=${labeled.length} status=${res.status} after ${Date.now() - callStartedAt}ms`);
    if (res.status === 429 || res.status >= 500) throw new OpenAiError(body, res.status);
    // Non-retryable — surface immediately instead of burning retries.
    throw Object.assign(new Error(`OpenAI error: ${body}`), { nonRetryable: true });
  }

  const json = await res.json() as { choices?: { message: { content: string }; finish_reason?: string }[] };
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  // "length" = the model hit max_tokens and got cut off mid-generation —
  // the single biggest real cause of "invalid JSON" on large multi-file
  // RFQs. Known upfront (not inferred from the parse failure) so the repair
  // path below and the truncation warning surfaced to the user are both
  // acting on a confirmed cause, not a guess.
  const truncatedByModel = choice?.finish_reason === "length";
  console.log(`[normalize] AI COMPLETE chars_in=${labeled.length} chars_out=${content.length} truncated=${truncatedByModel} in ${Date.now() - callStartedAt}ms`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    // Log the raw content — this is the one thing that's actually useful
    // for debugging a bad extraction after the fact, and it's otherwise
    // lost the moment this throws.
    logError("[normalize] AI returned invalid JSON", { rawContent: content.slice(0, 4000), parseError: err, truncatedByModel });

    // Always attempt repair on ANY parse failure, not just a confirmed
    // truncation — it's a cheap, local, no-cost string operation (no extra
    // network call), so there's no real reason to gate it. A RFQ that kept
    // failing across multiple already-shipped fixes (schema validation,
    // retries, truncation-only repair) turned out to be exactly this case:
    // finish_reason wasn't "length", so the truncation-only repair never
    // even tried, even though the same salvageable-items structure was
    // present in the malformed response. If nothing is salvageable, this
    // still falls through to a normal retry (fresh generation) as before.
    const repaired = tryRepairTruncatedJson(content);
    if (repaired) {
      logError("[normalize] recovered a malformed AI response via JSON repair", {
        recoveredItemCount: repaired.items?.length ?? 0,
        truncatedByModel,
      });
      return { data: repaired, truncated: true };
    }
    throw new InvalidAiJsonError("AI returned invalid JSON");
  }

  // Strict-enough schema validation before anything downstream trusts this
  // shape — reject silently-wrong structures (e.g. the model returning a
  // bare array, or "items" as a string) instead of letting them crash
  // later deep in the merge/insert logic.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    logError("[normalize] AI response was valid JSON but not the expected object shape", { rawContent: content.slice(0, 4000) });
    throw new InvalidAiJsonError("AI response was not in the expected format");
  }
  const obj = parsed as RawExtractionResponse;
  if (obj.items !== undefined && !Array.isArray(obj.items)) {
    logError("[normalize] AI response's \"items\" field was not an array", { rawContent: content.slice(0, 4000) });
    throw new InvalidAiJsonError("AI response's item list was not in the expected format");
  }

  return { data: obj, truncated: truncatedByModel };
}

const CHUNK_CHAR_LIMIT = 6000; // per-AI-call cap — keeps each call's expected item count (and output tokens) small enough to generate comfortably inside one attempt's timeout. This is what actually bounds latency for a large RFQ, not a bigger timeout number: a single call asked to extract everything from a big multi-file RFQ has to generate a proportionally huge JSON response, and token generation time scales with how much the model actually has to write.
const CHUNK_CONCURRENCY = 3; // parallel AI calls per RFQ — bounded so a many-chunk RFQ doesn't fire dozens of simultaneous OpenAI requests

// Splits the source text into per-call chunks small enough that no single
// AI call has to generate a huge JSON response. File boundaries are kept
// intact where possible (each chunk holds one or more WHOLE files) so the
// "file" field the model echoes back stays accurate; only a genuinely
// oversized single file is further sub-split by raw character count. Total
// content is still capped at MAX_COMBINED_CHARS, same bound as before —
// this only changes HOW that budget is sent to the AI (parallel small
// calls instead of one large serial one), not how much content is used.
function chunkLabeledFiles(files: MultiFileInput[]): string[] {
  const chunks: string[] = [];
  let current = "";
  let usedChars = 0;
  for (const f of files) {
    if (usedChars >= MAX_COMBINED_CHARS) break;
    const labeled = `--- FILE: ${f.fileName} ---\n${f.text}`.slice(0, MAX_COMBINED_CHARS - usedChars);
    if (labeled.length === 0) break;

    if (labeled.length > CHUNK_CHAR_LIMIT) {
      if (current) { chunks.push(current); current = ""; }
      for (let i = 0; i < labeled.length; i += CHUNK_CHAR_LIMIT) chunks.push(labeled.slice(i, i + CHUNK_CHAR_LIMIT));
      usedChars += labeled.length;
      continue;
    }
    const sepLen = current ? 2 : 0;
    if (current && current.length + sepLen + labeled.length > CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = labeled;
      usedChars += labeled.length;
    } else {
      current = current ? `${current}\n\n${labeled}` : labeled;
      usedChars += sepLen + labeled.length;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Sanitizes any error from a single chunk's extraction attempt into a safe
// public message + a logged technical detail — shared between the
// per-chunk fault-isolation path below (one bad chunk can't take the
// others down) and, if every chunk ultimately fails, the final thrown
// error the caller sees.
function sanitizeAiError(err: unknown): AiExtractionError {
  if (err instanceof OpenAiError) {
    logError("[normalize] OpenAI API error", { status: err.status, body: err.message.slice(0, 2000) });
    return new AiExtractionError(
      "The AI service is temporarily unavailable. Please try again in a few minutes.",
      `OpenAI error (status ${err.status}): ${err.message}`
    );
  }
  if (err instanceof InvalidAiJsonError) {
    return new AiExtractionError(
      "We couldn't reliably read this document — please try again, or upload the file manually.",
      err.message
    );
  }
  // Catch-all for everything else that can come out of fetch() — most
  // notably AbortSignal.timeout() firing, which rejects with a bare
  // DOMException (name: "TimeoutError", message: "The operation was
  // aborted due to timeout") that matches neither OpenAiError nor
  // InvalidAiJsonError above and was found leaking straight into a
  // user-facing RFQ's process_error column uncaught. Network errors (DNS
  // failure, connection reset, etc.) land here too. Nothing past this
  // point should ever reach a caller unsanitized.
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return new AiExtractionError(
    "The AI request took too long or the connection was unreliable. Please try again.",
    detail
  );
}

type ChunkOutcome = { data: RawExtractionResponse; truncated: boolean; failed: false } | { data: null; truncated: false; failed: true };

async function runChunk(labeled: string): Promise<ChunkOutcome> {
  try {
    const { data, truncated } = await withRetry(
      () => callAndParseOnce(labeled),
      {
        // Worst case here (every attempt times out) is 3 * 30s = 90s — a
        // single chunk's call already eats a large share of the process
        // route's overall time budget (see JOB_DEADLINE_MS there), so it
        // can't afford an unbounded retry budget on top of that. Callers
        // do NOT double-wrap this in another retry — an earlier version
        // did, and that compounding could exceed the route's maxDuration
        // and get the serverless function killed mid-flight, leaving the
        // job stuck "processing" forever with no terminal status ever
        // written. This budget alone must stay safe.
        retries: 2,
        label: "RFQ item extraction chunk",
        // Retry OpenAI's own transient failures (429/5xx), genuine network
        // errors (timeouts, connection resets), and invalid/malformed JSON
        // (a fresh generation often doesn't truncate at the same point) —
        // everything except the explicitly-tagged non-retryable 4xx case,
        // which fails the same way every time.
        isRetryable: (err) => !(err instanceof Error && (err as Error & { nonRetryable?: boolean }).nonRetryable),
      }
    );
    return { data, truncated, failed: false };
  } catch (err) {
    // One chunk failing (after its own retries) must never take the whole
    // RFQ down with it — same fault-isolation principle as one bad
    // attachment never freezing the whole RFQ. Log it (sanitized detail,
    // not raw) and let the caller salvage whatever the OTHER chunks
    // recovered; only if every chunk fails does the RFQ actually fail.
    const sanitized = sanitizeAiError(err);
    logError("[normalize] one extraction chunk failed (continuing with the rest)", sanitized.detail);
    return { data: null, truncated: false, failed: true };
  }
}

export async function normalizeAndCategorizeMulti(files: MultiFileInput[]): Promise<{ meta: RfqMeta; items: MergedItem[]; truncated: boolean }> {
  const chunks = chunkLabeledFiles(files);
  console.log(`[normalize] split ${files.length} file(s) into ${chunks.length} AI extraction chunk(s)`);

  const results = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, runChunk);
  const succeeded = results.filter((r): r is ChunkOutcome & { failed: false } => !r.failed);

  if (succeeded.length === 0) {
    throw new AiExtractionError(
      "We couldn't reliably read this document — please try again, or upload the file manually.",
      `All ${chunks.length} extraction chunk(s) failed`
    );
  }

  // A chunk that failed outright is treated the same as a truncated one
  // for warning purposes — either way, some items may be missing from
  // what was actually in the source document.
  const truncated = results.some((r) => r.failed || r.truncated);

  // Merge header metadata from whichever chunk actually has it — these
  // fields describe the RFQ as a whole, so the first chunk with a
  // non-null value for each wins rather than only trusting one chunk.
  const meta: RfqMeta = {
    source_rfq_number: null,
    buyer_name:        null,
    source_date:       null,
  };
  for (const r of succeeded) {
    if (meta.source_rfq_number === null && r.data.rfq_number) meta.source_rfq_number = String(r.data.rfq_number);
    if (meta.buyer_name        === null && r.data.supplier)   meta.buyer_name        = String(r.data.supplier);
    if (meta.source_date       === null && r.data.date)       meta.source_date       = String(r.data.date);
  }

  // The model is asked to echo the exact FILE label back, but LLMs
  // paraphrase — resolve to a known filename by substring match either
  // direction rather than trusting an exact string match.
  const knownFiles = files.map((f) => f.fileName);
  function resolveSourceFile(raw: unknown): string[] {
    if (!raw) return [];
    const s = String(raw).trim().toLowerCase();
    if (!s) return [];
    const match = knownFiles.find((f) => f.toLowerCase() === s)
      ?? knownFiles.find((f) => f.toLowerCase().includes(s) || s.includes(f.toLowerCase()));
    return match ? [match] : [];
  }

  // A running counter across ALL chunks (not reset per chunk) — using a
  // per-chunk index as the line_number fallback would produce duplicate
  // line numbers across chunks whenever the model didn't supply "n"
  // itself.
  let globalIndex = 0;
  const items: MergedItem[] = succeeded.flatMap((r) => {
    const raw = r.data.items ?? [];
    return (raw as Record<string, unknown>[]).map((item) => {
      const i = globalIndex++;
      const conf = Number(item.conf ?? 0.8);
      const warnings: string[] = [];
      if (!item.name) warnings.push("Item name could not be confidently extracted.");
      if (item.qty == null) warnings.push("Quantity was not found — please confirm with the source document.");
      if (conf < 0.6) warnings.push("Low overall extraction confidence — please double-check this row.");

      return {
        line_number:         Number(item.n ?? item.line_number ?? i + 1),
        raw_text:            String(item.name ?? ""),
        name:                String(item.name ?? ""),
        qty:                 item.qty != null ? Number(item.qty) : null,
        unit:                item.unit ? String(item.unit) : null,
        brand:               item.brand ? String(item.brand) : null,
        spec:                item.spec ? String(item.spec) : null,
        notes:               null,
        part_number:         item.part ? String(item.part) : null,
        delivery_details:    item.delivery ? String(item.delivery) : null,
        category:            (CATEGORIES.includes(item.cat as Category) ? item.cat : "GENERAL_HARDWARE") as Category,
        category_source:     "llm" as const,
        category_confidence: Number(item.conf ?? 0.8),
        confidence:          conf,
        source_files:        resolveSourceFile(item.file),
        warnings,
        merged_from_count:   1,
      };
    });
  }).filter((item) => item.name.trim().length > 0);

  return { meta, items: dedupeItems(items), truncated };
}
