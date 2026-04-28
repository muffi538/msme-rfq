import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchUnreadEmails } from "@/lib/email/gmail";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";

export const maxDuration = 60;

function generateRfqCode(): string {
  const year = new Date().getFullYear();
  const seq  = Math.floor(Math.random() * 90000) + 10000;
  return `RFQ-${year}-${seq}`;
}

function detectType(mime: string, filename: string): "pdf" | "excel" | "image" | "text" | null {
  if (mime.includes("pdf") || filename.endsWith(".pdf"))                       return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") ||
      /\.(xlsx|xls|csv|tsv)$/i.test(filename))                                 return "excel";
  if (mime.includes("image"))                                                   return "image";
  if (mime.includes("text/plain") || /\.(txt)$/i.test(filename))               return "text";
  return null;
}

// Use OpenAI to extract text from a PDF when pdf-parse fails
async function extractPdfWithOpenAI(buffer: Buffer): Promise<string> {
  const base64 = buffer.toString("base64");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: [
          {
            type: "file",
            file: {
              filename: "rfq.pdf",
              file_data: `data:application/pdf;base64,${base64}`,
            },
          },
          {
            type: "text",
            text: "Extract all text from this RFQ PDF document. Return only the raw text — preserve all item names, quantities, units, and specifications exactly as written.",
          },
        ],
      }],
    }),
  });
  const json = await res.json() as { choices?: { message: { content: string } }[]; error?: { message: string } };
  if (json.error) throw new Error(`OpenAI: ${json.error.message}`);
  return json.choices?.[0]?.message?.content ?? "";
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const emails = await fetchUnreadEmails(5);
    if (emails.length === 0) return NextResponse.json({ created: 0, message: "No new emails found" });

    let created = 0;
    const results: { rfqCode: string; subject: string; from: string; hasAttachment: boolean }[] = [];

    for (const email of emails) {
      // Dedup: skip if this message was already fetched
      const { count } = await supabase
        .from("rfqs")
        .select("*", { count: "exact", head: true })
        .like("file_name", `msgid:${email.messageId}%`);
      if ((count ?? 0) > 0) continue;

      let rawText     = "";
      let fileType: string | null = null;
      let fileName    = `msgid:${email.messageId}`;
      let hasAttachment = false;

      for (const att of email.attachments) {
        const t = detectType(att.mimeType, att.filename);
        if (!t) continue;
        hasAttachment = true;
        fileType = t;
        fileName = `msgid:${email.messageId}|${att.filename}`;

        if (t === "pdf") {
          // Step 1: try pdf-parse (fast, free)
          try { rawText = await parsePdf(att.buffer); } catch { /* ignore */ }

          // Step 2: if pdf-parse returned nothing, use OpenAI to read the PDF
          if (!rawText.trim()) {
            try { rawText = await extractPdfWithOpenAI(att.buffer); } catch { /* ignore */ }
          }

          // Step 3: absolute fallback — store base64 so process route can retry
          if (!rawText.trim()) {
            rawText = `base64pdf:${att.buffer.toString("base64")}`;
          }
          break;
        }

        if (t === "excel") { rawText = parseExcel(att.buffer); break; }
        if (t === "text")  { rawText = att.buffer.toString("utf-8"); break; }
        if (t === "image") {
          rawText = `base64img:${att.mimeType}:${att.buffer.toString("base64")}`;
          break;
        }
        break;
      }

      // Fallback: use email body if no attachment text
      if ((!rawText.trim() || rawText.startsWith("base64")) && email.bodyText.trim()) {
        rawText  = email.bodyText;
        fileType = "text";
      }

      const rfqCode = generateRfqCode();
      const { data: rfq } = await supabase
        .from("rfqs")
        .insert({
          user_id:     user.id,
          rfq_code:    rfqCode,
          buyer_name:  email.from,
          buyer_email: email.fromEmail,
          file_name:   fileName,
          file_type:   fileType,
          raw_text:    rawText,
          status:      "pending",
          priority:    /urgent|asap|priority/i.test(email.subject) ? "urgent" : "normal",
          created_at:  email.date.toISOString(),
        })
        .select("id")
        .single();

      if (!rfq) continue;
      results.push({ rfqCode, subject: email.subject, from: email.from, hasAttachment });
      created++;
    }

    return NextResponse.json({ created, results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Email fetch error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
