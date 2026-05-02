import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";

export const maxDuration = 60;

export type QuoteItem = {
  name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  notes: string | null;
};

export type ExtractedQuote = {
  supplier_name: string | null;
  items: QuoteItem[];
  delivery_days: number | null;
  validity_days: number | null;
  payment_terms: string | null;
  email_subject: string;
  email_body: string;
};

async function extractWithVision(base64: string, mimeType: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract all text from this supplier quotation image. Return only the raw text exactly as shown." },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } },
        ],
      }],
    }),
  });
  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

async function parseQuote(rawText: string, companyName: string): Promise<ExtractedQuote> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are helping an Indian MSME hardware/industrial supplies company reply to buyer enquiries.
A supplier sent back a quotation. Extract the details and write a professional buyer reply email.
Return ONLY valid JSON matching this schema exactly:
{
  "supplier_name": string | null,
  "items": [{ "name": string, "qty": number | null, "unit": string | null, "unit_price": number | null, "notes": string | null }],
  "delivery_days": number | null,
  "validity_days": number | null,
  "payment_terms": string | null,
  "email_subject": string,
  "email_body": string
}

For email_body: write in warm Indian business English. Include a friendly opening, a clear item-wise price list (with quantities and units), delivery and payment terms, and end with a call to confirm or contact. Sign off as "${companyName}". Do NOT include a subject line inside the body.`,
        },
        {
          role: "user",
          content: `Supplier quotation:\n\n${rawText}`,
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

  let parsed: ExtractedQuote;
  try {
    parsed = JSON.parse(content) as ExtractedQuote;
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  if (!parsed.items || !Array.isArray(parsed.items)) parsed.items = [];
  if (!parsed.email_subject) parsed.email_subject = "Quotation for Your Enquiry";
  if (!parsed.email_body) parsed.email_body = "";

  return parsed;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: settingRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .in("key", ["company_name"]);
  const companyName = settingRows?.find((r) => r.key === "company_name")?.value ?? "Procur.AI";

  const contentType = request.headers.get("content-type") ?? "";

  let rawText = "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const text = form.get("text") as string | null;

    if (text?.trim()) {
      rawText = text.trim();
    } else if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "application/octet-stream";

      if (mime.includes("pdf") || file.name.toLowerCase().endsWith(".pdf")) {
        try {
          rawText = await parsePdf(buffer);
        } catch {
          rawText = await extractWithVision(buffer.toString("base64"), "application/pdf");
        }
      } else if (mime.includes("image")) {
        rawText = await extractWithVision(buffer.toString("base64"), mime);
      } else if (mime.includes("sheet") || mime.includes("excel") || file.name.match(/\.(xlsx?|csv)$/i)) {
        rawText = parseExcel(buffer);
      } else {
        rawText = buffer.toString("utf-8");
      }
    }
  } else {
    const body = await request.json() as { text?: string };
    rawText = body.text?.trim() ?? "";
  }

  if (!rawText.trim()) {
    return NextResponse.json({ error: "No content could be extracted. Please try again." }, { status: 422 });
  }

  try {
    const quote = await parseQuote(rawText, companyName);
    return NextResponse.json(quote);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI processing failed" },
      { status: 500 }
    );
  }
}
