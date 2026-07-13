import { NextResponse, after } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";
import { fetchUnreadEmails, markAsRead } from "@/lib/email/gmail";
import { detectFileType } from "@/lib/parsers/parseFile";
import { generateRfqCode } from "@/lib/rfq";
import { checkRateLimit } from "@/lib/rateLimit";
import { createJob, updateJob } from "@/lib/jobs";
import { withRetry } from "@/lib/retry";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

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

      // Detect every supported attachment — NOT just the first one. Actual
      // parsing (OCR/PDF/etc, the slow + costly part) is deliberately
      // deferred to the "Process it" step, same as before this fix; here we
      // only need to know which attachments exist and store their bytes.
      const supported = email.attachments
        .map((att) => ({ att, type: detectFileType(att.filename, att.mimeType) }))
        .filter((a): a is { att: typeof email.attachments[number]; type: NonNullable<typeof a.type> } => a.type !== null);

      let rawText  = "";
      let fileType: string | null = null;
      const fileName = supported.length > 0
        ? `msgid:${email.messageId}|${supported[0].att.filename}`
        : `msgid:${email.messageId}`;

      if (supported.length === 0 && email.bodyText.trim()) {
        // No supported attachment — fall back to the email body itself.
        rawText  = email.bodyText;
        fileType = "text";
      } else if (supported.length > 0) {
        fileType = supported.length === 1 ? supported[0].type : "mixed";
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

      // Store every supported attachment's raw bytes now (cheap); parsing
      // happens later when the user clicks "Process it".
      if (supported.length > 0) {
        const fileRows = [];
        const uploadedRows = await mapWithConcurrency(supported, 3, async ({ att, type }) => {
          const path = `${userId}/${Date.now()}-${att.filename}`;
          try {
            await withRetry(
              async () => {
                const { error: storageError } = await supabase.storage.from("rfq-files").upload(path, att.buffer, { upsert: false });
                if (storageError) throw storageError;
              },
              { retries: 2, label: `upload "${att.filename}"` }
            );
            return {
              rfq_id: rfq.id, user_id: userId, file_name: att.filename,
              file_url: path, file_type: type, raw_text: null, status: "pending",
            };
          } catch (err) {
            logError("[email-fetch] attachment upload failed", { messageId: email.messageId, filename: att.filename, error: err });
            return {
              rfq_id: rfq.id, user_id: userId, file_name: att.filename,
              file_url: null, file_type: type, raw_text: null, status: "pending",
            };
          }
        });
        fileRows.push(...uploadedRows);

        const { error: filesError } = await supabase.from("rfq_files").insert(fileRows);
        if (filesError) logError("[email-fetch] rfq_files insert failed", { messageId: email.messageId, error: filesError });
      }

      // Only mark read now that it's safely saved — if this fails, we still
      // want the message to be picked up again on the next fetch.
      try { await markAsRead(email.messageId, refreshToken); } catch { /* best-effort */ }

      results.push({ rfqCode, subject: email.subject, from: email.from, hasAttachment: supported.length > 0 });
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
