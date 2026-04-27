import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchUnreadEmails } from "@/lib/email/imap";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { normalizeAndCategorize } from "@/lib/ai/normalize";

export const maxDuration = 60;

function generateRfqCode(): string {
  const year = new Date().getFullYear();
  const seq  = Math.floor(Math.random() * 90000) + 10000;
  return `RFQ-${year}-${seq}`;
}

function detectType(mime: string, filename: string): "pdf" | "excel" | "image" | "text" | null {
  if (mime.includes("pdf") || filename.endsWith(".pdf"))                            return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") ||
      /\.(xlsx|xls|csv|tsv)$/i.test(filename))                                      return "excel";
  if (mime.includes("image"))                                                        return "image";
  if (mime.includes("text/plain") || /\.(txt)$/i.test(filename))                   return "text";
  return null;
}

async function extractTextViaOpenAI(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const isPdf  = mimeType.includes("pdf");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: isPdf
          ? [
              { type: "text", text: "Extract all text from this RFQ document. Return just the raw text, preserve item names, quantities and units." },
              { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${base64}` } },
            ]
          : [
              { type: "text", text: "Extract all text from this RFQ image. Return just the raw text, no commentary." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
      }],
    }),
  });
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    // 1 — Pull unread emails from Gmail
    const emails = await fetchUnreadEmails(20);
    if (emails.length === 0) return NextResponse.json({ created: 0, message: "No new emails found" });

    let created = 0;
    const results: { rfqCode: string; subject: string; itemCount: number }[] = [];

    for (const email of emails) {
      // Dedup: skip if this messageId was already imported (stored in file_name)
      const { count } = await supabase
        .from("rfqs")
        .select("*", { count: "exact", head: true })
        .eq("file_name", `msgid:${email.messageId}`);
      if ((count ?? 0) > 0) continue;

      // 2 — Parse the first useful attachment
      let rawText  = "";
      let fileType: "pdf" | "excel" | "image" | "text" | null = null;
      let fileName = `msgid:${email.messageId}`;

      for (const att of email.attachments) {
        const t = detectType(att.mimeType, att.filename);
        if (!t) continue;

        fileName = att.filename;

        if (t === "pdf") {
          try {
            rawText = await parsePdf(att.buffer);
          } catch {
            rawText = await extractTextViaOpenAI(att.buffer, "application/pdf");
          }
          fileType = "pdf";
          break;
        }
        if (t === "excel") {
          rawText  = parseExcel(att.buffer);
          fileType = "excel";
          break;
        }
        if (t === "text") {
          rawText  = att.buffer.toString("utf-8");
          fileType = "text";
          break;
        }
        if (t === "image") {
          rawText  = await extractTextViaOpenAI(att.buffer, att.mimeType);
          fileType = "image";
          break;
        }
      }

      // Fall back to email body text if no attachment was useful
      if (!rawText.trim() && email.bodyText.trim()) {
        rawText  = email.bodyText;
        fileType = null;
        fileName = `msgid:${email.messageId}`;
      }

      if (!rawText.trim()) continue;

      const isUrgent = /urgent|asap|priority/i.test(email.subject);
      const rfqCode  = generateRfqCode();

      // 3 — Insert RFQ
      const { data: rfq, error: rfqErr } = await supabase
        .from("rfqs")
        .insert({
          user_id:     user.id,
          rfq_code:    rfqCode,
          buyer_name:  email.from,
          buyer_email: email.fromEmail,
          file_name:   fileName,
          file_type:   fileType,
          raw_text:    rawText,
          status:      "processing",
          priority:    isUrgent ? "urgent" : "normal",
        })
        .select("id")
        .single();

      if (rfqErr || !rfq) continue;

      // 4 — AI: normalize + categorize
      const items = await normalizeAndCategorize(rawText);

      if (items.length > 0) {
        await supabase.from("rfq_items").insert(
          items.map((item) => ({
            rfq_id:              rfq.id,
            user_id:             user.id,
            line_number:         item.line_number,
            raw_text:            item.raw_text,
            name:                item.name,
            qty:                 item.qty,
            unit:                item.unit,
            brand:               item.brand,
            spec:                item.spec,
            notes:               item.notes,
            category:            item.category,
            category_source:     item.category_source,
            category_confidence: item.category_confidence,
            flagged:             item.category_confidence < 0.7,
          }))
        );
      }

      await supabase.from("rfqs").update({ status: "processed" }).eq("id", rfq.id);
      results.push({ rfqCode, subject: email.subject, itemCount: items.length });
      created++;
    }

    return NextResponse.json({ created, results });
  } catch (err: unknown) {
    console.error("Email fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
