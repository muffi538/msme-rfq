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

    result.push(kept);
  }

  return result.sort((a, b) => a.line_number - b.line_number);
}

export async function normalizeAndCategorizeMulti(files: MultiFileInput[]): Promise<{ meta: RfqMeta; items: MergedItem[] }> {
  const labeled = files
    .map((f) => `--- FILE: ${f.fileName} ---\n${f.text}`)
    .join("\n\n")
    .slice(0, MAX_COMBINED_CHARS);

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
          content: "You are a procurement assistant. Multiple source files (possibly duplicating each other) describe ONE request for quotation. Extract RFQ-level metadata plus every line item and return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Return JSON:
{"rfq_number": "..." or null, "supplier": "..." or null, "date": "..." or null,
 "items": [{"n":1,"name":"item name","qty":5,"unit":"pcs","brand":null,"spec":null,"part":null,"delivery":null,"cat":"POWER_TOOLS","conf":0.9},...]}

Categories: POWER_TOOLS, HAND_TOOLS, FURNITURE_FITTINGS, SAFETY_ITEMS, FASTENERS, SANITARY_PLUMBING, PAINTS, VALVES_FITTINGS, PACKAGING_MATERIALS, ELECTRICAL, HVAC, GENERAL_HARDWARE

Field meanings: "supplier" = whoever authored/sent this RFQ document (their company name, if stated). "part" = part number / SKU / model code, if printed. "delivery" = any delivery location, date, or lead-time text tied to that item or the whole order. "conf" = your confidence (0-1) in the overall accuracy of that item's extracted fields, not just its category.

Rules: skip headers/totals/page numbers. If the same item is described in more than one FILE section, still list it once per FILE section — a later merge step deduplicates. Normalize Hindi to English. SS=Stainless Steel, GI=Galvanized Iron, MS=Mild Steel. qty=null if missing.

SOURCE FILES:
${labeled}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const json = await res.json() as { choices?: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");

  let parsed: { rfq_number?: unknown; supplier?: unknown; date?: unknown; items?: unknown[] };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const meta: RfqMeta = {
    source_rfq_number: parsed.rfq_number ? String(parsed.rfq_number) : null,
    buyer_name:        parsed.supplier   ? String(parsed.supplier)   : null,
    source_date:       parsed.date       ? String(parsed.date)       : null,
  };

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
      warnings,
      merged_from_count:   1,
    };
  }).filter((item) => item.name.trim().length > 0);

  return { meta, items: dedupeItems(items) };
}
