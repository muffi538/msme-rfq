import { logError } from "@/lib/logError";
import { BUILT_IN_CATEGORIES as CATEGORIES } from "@/lib/categories";

// Fallback AI provider — every function here is only ever called AFTER
// OpenAI has already been tried and exhausted its own retries/fallback
// (see normalize.ts's runChunk and parseFile.ts's OCR calls). Deliberately
// a self-contained, parallel implementation rather than a refactor of the
// OpenAI call paths, so the already-tuned, already-hardened OpenAI
// pipeline stays completely undisturbed and remains the unconditional
// default. Every export here is a no-op (never called) when
// GEMINI_API_KEY isn't set — installs that don't configure it behave
// byte-identically to before Gemini support existed.

const GEMINI_MODEL = "gemini-3.7-flash";
const CATEGORIES_PROMPT_LIST = CATEGORIES.join(", ");

export function hasGeminiFallback(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

async function callGemini(
  parts: unknown[],
  opts: { responseSchema?: unknown; timeoutMs: number; label: string }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const generationConfig: Record<string, unknown> = { temperature: 0 };
  if (opts.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.responseSchema;
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts }], generationConfig }),
        signal: AbortSignal.timeout(opts.timeoutMs),
      }
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    console.log(`[gemini] ${opts.label} NETWORK FAILURE (${name}) after ${Date.now() - startedAt}ms`);
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    console.log(`[gemini] ${opts.label} FAILED status=${res.status} after ${Date.now() - startedAt}ms body=${body.slice(0, 500)}`);
    throw new Error(`Gemini error (${res.status})`);
  }

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: unknown;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log(`[gemini] ${opts.label} COMPLETE durationMs=${Date.now() - startedAt} finishReason=${json.candidates?.[0]?.finishReason ?? "?"} usage=${JSON.stringify(json.usageMetadata ?? {})}`);
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

// OCR fallback — same job as extractTextViaOpenAI (extractText.ts): plain
// transcription, no structured schema, so responseSchema is omitted (a
// schema would push Gemini toward wrapping the output as JSON, which isn't
// wanted here — the caller wants raw text back, same as the OpenAI path).
export async function extractTextViaGemini(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  return callGemini(
    [
      { text: "Extract all text from this document. Return just the raw text, preserve item names, quantities and units." },
      { inline_data: { mime_type: mimeType, data: base64 } },
    ],
    { timeoutMs: 45000, label: "OCR" }
  );
}

// Mirrors normalize.ts's EXTRACTION_JSON_SCHEMA field-for-field (same 11
// item fields, same top-level rfq_number/supplier/date/items shape) so the
// caller's merge/dedup/attribution logic downstream never has to know or
// care which provider actually produced a given chunk's items. Gemini uses
// its own OpenAPI-subset schema format (UPPERCASE type names, `nullable`
// instead of `anyOf`), not OpenAI's JSON Schema dialect — this is a
// deliberate translation, not a shared schema, since the two APIs don't
// accept the same shape.
const GEMINI_EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    rfq_number: { type: "STRING", nullable: true },
    supplier:   { type: "STRING", nullable: true },
    date:       { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          n:        { type: "INTEGER" },
          name:     { type: "STRING" },
          qty:      { type: "NUMBER", nullable: true },
          unit:     { type: "STRING", nullable: true },
          brand:    { type: "STRING", nullable: true },
          spec:     { type: "STRING", nullable: true },
          part:     { type: "STRING", nullable: true },
          delivery: { type: "STRING", nullable: true },
          cat:      { type: "STRING", enum: [...CATEGORIES] },
          conf:     { type: "NUMBER" },
          file:     { type: "INTEGER" },
        },
        required: ["n", "name", "qty", "unit", "brand", "spec", "part", "delivery", "cat", "conf", "file"],
      },
    },
  },
  required: ["rfq_number", "supplier", "date", "items"],
};

export type GeminiExtractionResult = {
  rfq_number: string | null;
  supplier: string | null;
  date: string | null;
  items: unknown[];
};

// Extraction fallback — mirrors callAndParseOnce's prompt (normalize.ts)
// closely enough that Gemini receives the same instructions OpenAI would
// have, just addressed to a different model's structured-output mechanism.
export async function extractItemsViaGemini(labeled: string): Promise<GeminiExtractionResult> {
  const prompt = `Return JSON:
{"rfq_number": "..." or null, "supplier": "..." or null, "date": "..." or null,
 "items": [{"n":1,"name":"item name","qty":5,"unit":"pcs","brand":null,"spec":null,"part":null,"delivery":null,"cat":"POWER_TOOLS","conf":0.9,"file":1},...]}

Categories: ${CATEGORIES_PROMPT_LIST}

Field meanings: "supplier" = whoever authored/sent this RFQ document (their company name, if stated). "part" = part number / SKU / model code, if printed. "delivery" = any delivery location, date, or lead-time text tied to that item or the whole order. "conf" = your confidence (0-1) in the overall accuracy of that item's extracted fields, not just its category. "file" = the NUMBER (not the name) from the "--- FILE N: ... ---" heading this item was found under, e.g. 1 for "--- FILE 1: ... ---".

Rules: skip headers/totals/page numbers. If the same item is described in more than one FILE section, still list it once per FILE section — a later merge step deduplicates. Normalize Hindi to English. SS=Stainless Steel, GI=Galvanized Iron, MS=Mild Steel. qty=null if missing.

SOURCE FILES:
${labeled}`;

  const text = await callGemini(
    [{ text: prompt }],
    { responseSchema: GEMINI_EXTRACTION_SCHEMA, timeoutMs: 30000, label: `extraction chars=${labeled.length}` }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logError("[gemini] extraction returned invalid JSON", { rawContent: text.slice(0, 4000), parseError: err });
    throw new Error("Gemini returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Gemini response was not in the expected format");
  }
  return parsed as GeminiExtractionResult;
}
