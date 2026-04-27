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
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const json = await res.json() as { choices: { message: { content: string } }[] };
  const content = json.choices[0].message.content;

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
