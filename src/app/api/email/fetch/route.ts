import { NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { fetchUnreadEmails, markAsRead } from "@/lib/email/gmail";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseExcel } from "@/lib/parsers/excel";
import { generateRfqCode } from "@/lib/rfq";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob } from "@/lib/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

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
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json() as { choices?: { message: { content: string } }[]; error?: { message: string } };
  if (json.error) throw new Error(`OpenAI: ${json.error.message}`);
  return json.choices?.[0]?.message?.content ?? "";
}

// The actual work — runs after the response has already gone back to the
// client (see after() in POST below), so it never blocks the UI. Every step
// updates the job row instead of returning anything directly.
async function runEmailFetchJob(supabase: SupabaseClient, userId: string, jobId: string, refreshToken: string) {
  try {
    await updateJob(supabase, jobId, { status: "running" });

    const emails = await fetchUnreadEmails(20, refreshToken);
    console.log("[email-fetch] Gmail returned", emails.length, "unread message(s)");

    if (emails.length === 0) {
      await updateJob(supabase, jobId, {
        status: "done",
        result: { created: 0, fetched: 0, message: "No new emails found" },
      });
      return;
    }

    let created = 0;
    let deduped = 0;
    let insertFailed = 0;
    let lastInsertError: string | null = null;
    const results: { rfqCode: string; subject: string; from: string; hasAttachment: boolean }[] = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      await updateJob(supabase, jobId, { progress: { processed: i, total: emails.length } });

      // Dedup: skip if this message was already fetched
      const { count } = await supabase
        .from("rfqs")
        .select("*", { count: "exact", head: true })
        .like("file_name", `msgid:${email.messageId}%`);
      if ((count ?? 0) > 0) {
        deduped++;
        // Already saved previously — safe to clear from unread so it stops
        // showing up in every future fetch.
        try { await markAsRead(email.messageId, refreshToken); } catch { /* best-effort */ }
        continue;
      }

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

      const rfqCode = await generateRfqCode(supabase);
      const { data: rfq, error: insertError } = await supabase
        .from("rfqs")
        .insert({
          user_id:     userId,
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

      if (insertError || !rfq) {
        insertFailed++;
        lastInsertError = insertError?.message ?? "insert returned no row";
        logError("[email-fetch] rfq insert failed", { messageId: email.messageId, error: insertError });
        continue;
      }
      // Only mark read now that it's safely saved — if this fails, we still
      // want the message to be picked up again on the next fetch.
      try { await markAsRead(email.messageId, refreshToken); } catch { /* best-effort */ }

      results.push({ rfqCode, subject: email.subject, from: email.from, hasAttachment });
      created++;
    }

    console.log("[email-fetch] done", { fetched: emails.length, created, deduped, insertFailed });
    await updateJob(supabase, jobId, {
      status: "done",
      progress: { processed: emails.length, total: emails.length },
      result: { created, results, fetched: emails.length, deduped, insertFailed, lastInsertError },
    });
  } catch (err: unknown) {
    logError("Email fetch job failed:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    await updateJob(supabase, jobId, { status: "failed", error: msg });
  }
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Each fetch can trigger up to 20 Gmail API calls plus OpenAI fallback
  // calls — cap how often it can be triggered.
  const allowed = await checkRateLimit(supabase, user.id, "email-fetch", 300, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many fetch requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  // Look up this user's own Gmail refresh token.
  // .limit(1) instead of .single() — a duplicate row for this user_id+key
  // would make .single() error out and look like "not connected".
  const { data: tokenRows, error: tokenLookupError } = await supabase
    .from("user_settings")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", "gmail_refresh_token")
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokenLookupError) logError("[email-fetch] token lookup failed", tokenLookupError);
  const refreshToken = tokenRows?.[0]?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { error: "Gmail not connected. Please connect your Gmail account first." },
      { status: 400 }
    );
  }

  const { job, error: jobError } = await createJob(supabase, user.id, "email_fetch");
  if (jobError || !job) {
    logError("[email-fetch] could not create job", jobError);
    return NextResponse.json({ error: "Could not start email fetch. Please try again." }, { status: 500 });
  }

  // Runs after this response is sent — the client gets the job id back
  // immediately and polls /api/jobs/[id] instead of waiting on this request.
  after(() => runEmailFetchJob(supabase, user.id, job.id, refreshToken));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
