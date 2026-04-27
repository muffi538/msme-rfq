import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchUnreadEmails } from "@/lib/email/imap";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { normalizeAndCategorize } from "@/lib/ai/normalize";

function generateRfqCode(): string {
  const year = new Date().getFullYear();
  const seq  = Math.floor(Math.random() * 90000) + 10000;
  return `RFQ-${year}-${seq}`;
}

function detectType(mime: string, filename: string): "pdf" | "excel" | "image" | null {
  if (mime.includes("pdf") || filename.endsWith(".pdf"))          return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") ||
      /\.(xlsx|xls|csv|tsv)$/i.test(filename))                   return "excel";
  if (mime.includes("image"))                                     return "image";
  return null;
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
      // Skip if already imported (dedup by messageId)
      const { count } = await supabase
        .from("rfqs")
        .select("*", { count: "exact", head: true })
        .eq("buyer_email", email.fromEmail)
        .eq("rfq_code", email.messageId);
      if ((count ?? 0) > 0) continue;

      // 2 — Pick the first processable attachment (or fall back to body text)
      let rawText  = "";
      let fileType: "pdf" | "excel" | "image" | null = null;
      let fileName = "email-body.txt";

      for (const att of email.attachments) {
        const t = detectType(att.mimeType, att.filename);
        if (!t) continue;

        if (t === "pdf") {
          rawText  = await parsePdf(att.buffer);
          fileType = "pdf";
          fileName = att.filename;
          break;
        }
        if (t === "excel") {
          rawText  = parseExcel(att.buffer);
          fileType = "excel";
          fileName = att.filename;
          break;
        }
        if (t === "image") {
          // OpenAI Vision
          const b64 = att.buffer.toString("base64");
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: [
                { type: "text", text: "Extract all text from this RFQ image. Return only the raw text." },
                { type: "image_url", image_url: { url: `data:${att.mimeType};base64,${b64}` } },
              ]}],
            }),
          });
          const j = await res.json();
          rawText  = j.choices?.[0]?.message?.content ?? "";
          fileType = "image";
          fileName = att.filename;
          break;
        }
      }

      // Fall back to email body if no useful attachment
      if (!rawText.trim() && email.bodyText.trim()) {
        rawText  = email.bodyText;
        fileType = null;
        fileName = "email-body.txt";
      }

      if (!rawText.trim()) continue;

      const isUrgent = /urgent|asap|priority/i.test(email.subject);
      const rfqCode  = generateRfqCode();

      // 3 — Insert RFQ
      const { data: rfq, error: rfqErr } = await supabase
        .from("rfqs")
        .insert({
          user_id:    user.id,
          rfq_code:   rfqCode,
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
