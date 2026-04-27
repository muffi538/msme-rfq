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
  const prompt = `You are an expert procurement assistant for Indian MSME hardware companies.

Extract all line items from this RFQ text and return ONLY a JSON array. No explanation, no markdown.

Each item must follow this exact shape:
{
  "line_number": number,
  "raw_text": string,
  "name": string,
  "qty": number | null,
  "unit": string | null,
  "brand": string | null,
  "spec": string | null,
  "notes": string | null,
  "category": one of exactly: POWER_TOOLS, HAND_TOOLS, FURNITURE_FITTINGS, SAFETY_ITEMS, FASTENERS, SANITARY_PLUMBING, PAINTS, VALVES_FITTINGS, PACKAGING_MATERIALS, ELECTRICAL, HVAC, GENERAL_HARDWARE,
  "category_confidence": number between 0 and 1
}

Rules:
- Skip header rows, totals, page numbers, signatures.
- Normalize Hindi/Hinglish item names to English.
- Expand: SS → Stainless Steel, GI → Galvanized Iron, MS → Mild Steel.
- If qty is missing, set null.
- Use GENERAL_HARDWARE only when no other category fits.

RFQ Text:
${rawText}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You return only valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const json = await res.json();
  const content = json.choices[0].message.content;
  const parsed = JSON.parse(content);

  // OpenAI sometimes wraps in { items: [...] } — handle both
  const items: CategorisedItem[] = Array.isArray(parsed)
    ? parsed
    : (parsed.items ?? Object.values(parsed)[0] ?? []);

  return items.map((item, i) => ({
    ...item,
    line_number: item.line_number ?? i + 1,
    category_source: "llm" as const,
    category_confidence: item.category_confidence ?? 0.8,
  }));
}
