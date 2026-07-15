import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { checkRateLimit } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";
import { mapWithConcurrency } from "@/lib/concurrency";

export const maxDuration = 60;

// A supplier's quotation sometimes arrives as several WhatsApp screenshots
// (a long price list that didn't fit in one screen) rather than a single
// image — this caps how many can be combined into one extraction request,
// keeping both cost and the route's own maxDuration bounded.
const MAX_FILES = 6;
// Bounded concurrency for the per-file vision/parse calls — several images
// run in parallel rather than serially, since each vision call alone can
// take up to 45s and this route's own budget is 60s total.
const FILE_CONCURRENCY = 3;

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
    signal: AbortSignal.timeout(45000),
  });
  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

// Extracts raw text from one uploaded file, routing by type exactly like
// the single-file path used to inline in the POST handler — pulled out so
// multiple files can each go through the same logic and run concurrently.
// Never throws: a failure on one file must not take the whole batch down,
// same fault-isolation principle as the main RFQ pipeline's per-attachment
// handling.
async function extractTextFromFile(file: File): Promise<{ name: string; text: string; error: string | null }> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    let text = "";
    if (mime.includes("pdf") || file.name.toLowerCase().endsWith(".pdf")) {
      try {
        text = await parsePdf(buffer);
      } catch {
        text = await extractWithVision(buffer.toString("base64"), "application/pdf");
      }
    } else if (mime.includes("image")) {
      text = await extractWithVision(buffer.toString("base64"), mime);
    } else if (mime.includes("sheet") || mime.includes("excel") || file.name.match(/\.(xlsx?|csv)$/i)) {
      text = parseExcel(buffer);
    } else {
      text = buffer.toString("utf-8");
    }
    return { name: file.name, text, error: null };
  } catch (err) {
    return { name: file.name, text: "", error: err instanceof Error ? err.message : `Could not read "${file.name}"` };
  }
}

async function parseQuote(
  rawText: string,
  companyName: string,
  buyerReplyTemplate: string | null
): Promise<ExtractedQuote> {
  const templateGuide = buyerReplyTemplate
    ? `\n\nUse this template as the structure/tone for the email_body. Substitute the placeholders with the extracted values, keep the wording natural, and adapt it as needed:\n\n---\n${buyerReplyTemplate}\n---\n\nPlaceholders the user defined: {customer} = the buyer name (use a polite generic like "Sir/Madam" if unknown), {items} = item-wise list with qty + unit price, {totalPrice} = sum total in ₹, {deliveryDays}, {paymentTerms}, {validityDays}, {company} = "${companyName}".`
    : `\n\nFor email_body: write in warm Indian business English. Include a friendly opening, a clear item-wise price list (with quantities and units), delivery and payment terms, and end with a call to confirm or contact. Sign off as "${companyName}".`;

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
The input may be split across multiple screenshots or files (e.g. a long price list that didn't fit in one WhatsApp screenshot, each marked "--- Screenshot/File N ---") — treat them as ONE combined quotation from ONE supplier and merge into a single item list, not separate quotes.
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
${templateGuide}
Do NOT include a subject line inside the body.`,
        },
        {
          role: "user",
          content: `Supplier quotation:\n\n${rawText}`,
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

  const allowed = await checkRateLimit(supabase, user.id, "rfq-reply-extract", 600, 20);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  const { data: settingRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .in("key", ["company_name", "buyer_reply_template"]);
  const companyName        = settingRows?.find((r) => r.key === "company_name")?.value         ?? "Procur.AI";
  const buyerReplyTemplate = settingRows?.find((r) => r.key === "buyer_reply_template")?.value ?? null;

  const contentType = request.headers.get("content-type") ?? "";

  let rawText = "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    // "files" (plural) — a quotation can arrive as several WhatsApp
    // screenshots (a long price list split across screens) rather than
    // one image. "file" (singular) is still accepted for backward
    // compatibility with any older client sending exactly one.
    const uploadedFiles = [...form.getAll("files"), ...form.getAll("file")]
      .filter((f): f is File => f instanceof File);
    const text = form.get("text") as string | null;

    if (text?.trim()) {
      rawText = text.trim();
    } else if (uploadedFiles.length > 0) {
      if (uploadedFiles.length > MAX_FILES) {
        return NextResponse.json({ error: `Too many files — maximum ${MAX_FILES} at once.` }, { status: 413 });
      }

      const results = await mapWithConcurrency(uploadedFiles, FILE_CONCURRENCY, extractTextFromFile);
      const usable = results.filter((r) => !r.error && r.text.trim());
      const failed = results.filter((r) => r.error);

      if (usable.length === 0) {
        return NextResponse.json(
          {
            error: failed.length > 0
              ? `Could not extract any content from the file(s). ${failed.map((f) => f.error).join(" ")}`
              : "No content could be extracted. Please try again.",
          },
          { status: 422 }
        );
      }

      // Multiple files are labeled so the AI (per the system prompt above)
      // treats them as one combined quotation rather than separate ones —
      // same labeling convention as the main RFQ extraction pipeline.
      rawText = usable.length === 1
        ? usable[0].text
        : usable.map((r, i) => `--- Screenshot/File ${i + 1}: ${r.name} ---\n${r.text}`).join("\n\n");
    }
  } else {
    const body = await request.json() as { text?: string };
    rawText = body.text?.trim() ?? "";
  }

  if (!rawText.trim()) {
    return NextResponse.json({ error: "No content could be extracted. Please try again." }, { status: 422 });
  }

  try {
    const quote = await parseQuote(rawText, companyName, buyerReplyTemplate);
    return NextResponse.json(quote);
  } catch (err: unknown) {
    logError("[rfq-reply/extract] parseQuote failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI processing failed" },
      { status: 500 }
    );
  }
}
