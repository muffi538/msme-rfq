import { withRetry } from "@/lib/retry";
import { logError } from "@/lib/logError";

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
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 8000, // bumped from 4000 — a large multi-file RFQ (many line items) could hit the old cap mid-object, producing truncated/invalid JSON
      response_format: { type: "json_object" },
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
    // Tightened from 35s to keep a 3-attempt budget (see retries: 2 below)
    // safely inside JOB_DEADLINE_MS in the process route — gpt-4o-mini
    // typically returns well under this for the input sizes used here.
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const body = await res.text();
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    // Log the raw content — this is the one thing that's actually useful
    // for debugging a bad extraction after the fact, and it's otherwise
    // lost the moment this throws.
    logError("[normalize] AI returned invalid JSON", { rawContent: content.slice(0, 4000), parseError: err, truncatedByModel });

    // Only repair a CONFIRMED truncation. A fresh retry (the normal path,
    // one level up) is likelier to just work for a one-off malformation
    // unrelated to length — repairing immediately here would spend that
    // retry attempt for no reason. But a genuine max_tokens cutoff on
    // deterministic (temperature: 0) input is likely to truncate at nearly
    // the same point again, so salvaging what's already recovered here beats
    // gambling a full retry on an outcome that's probably the same.
    if (truncatedByModel) {
      const repaired = tryRepairTruncatedJson(content);
      if (repaired) {
        logError("[normalize] recovered a truncated AI response via JSON repair", {
          recoveredItemCount: repaired.items?.length ?? 0,
        });
        return { data: repaired, truncated: true };
      }
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

export async function normalizeAndCategorizeMulti(files: MultiFileInput[]): Promise<{ meta: RfqMeta; items: MergedItem[]; truncated: boolean }> {
  const labeled = files
    .map((f) => `--- FILE: ${f.fileName} ---\n${f.text}`)
    .join("\n\n")
    .slice(0, MAX_COMBINED_CHARS);

  const { data: parsed, truncated } = await withRetry(
    () => callAndParseOnce(labeled),
    {
      // Worst case here (every attempt times out) is 3 * 20s = 60s — this
      // single call already eats a large share of the process route's
      // overall time budget (see JOB_DEADLINE_MS there), so it can't afford
      // an unbounded retry budget on top of that. The caller does NOT
      // double-wrap this in another retry — an earlier version did, and
      // that compounding could exceed the route's maxDuration and get the
      // serverless function killed mid-flight, leaving the job stuck
      // "processing" forever with no terminal status ever written. This
      // budget alone must stay safe.
      retries: 2,
      label: "RFQ item extraction",
      // Retry OpenAI's own transient failures (429/5xx), genuine network
      // errors (timeouts, connection resets), and invalid/malformed JSON
      // (a fresh generation often doesn't truncate at the same point) —
      // everything except the explicitly-tagged non-retryable 4xx case,
      // which fails the same way every time.
      isRetryable: (err) => !(err instanceof Error && (err as Error & { nonRetryable?: boolean }).nonRetryable),
    }
  ).catch((err) => {
    // Never let a raw OpenAI error body or internal exception detail reach
    // an end user — only AiExtractionError's generic `message` is safe for
    // that; everything technical goes to `detail`, which callers must log,
    // not display.
    if (err instanceof OpenAiError) {
      logError("[normalize] OpenAI API error", { status: err.status, body: err.message.slice(0, 2000) });
      throw new AiExtractionError(
        "The AI service is temporarily unavailable. Please try again in a few minutes.",
        `OpenAI error (status ${err.status}): ${err.message}`
      );
    }
    if (err instanceof InvalidAiJsonError) {
      throw new AiExtractionError(
        "We couldn't reliably read this document — please try again, or upload the file manually.",
        err.message
      );
    }
    throw err;
  });

  const meta: RfqMeta = {
    source_rfq_number: parsed.rfq_number ? String(parsed.rfq_number) : null,
    buyer_name:        parsed.supplier   ? String(parsed.supplier)   : null,
    source_date:       parsed.date       ? String(parsed.date)       : null,
  };

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

  const raw = parsed.items ?? [];
  const items: MergedItem[] = (raw as Record<string, unknown>[]).map((item, i) => {
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
  }).filter((item) => item.name.trim().length > 0);

  return { meta, items: dedupeItems(items), truncated };
}
