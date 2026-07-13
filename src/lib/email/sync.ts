// Shared core for both the manual "Fetch Now" button and the every-2-minute
// cron. Both paths must dedup, insert, and checkpoint identically — keeping
// the logic in one place is what makes that guarantee possible instead of
// two implementations silently drifting apart.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logError";
import {
  fetchUnreadEmails,
  fetchMessagesByIds,
  getGmailProfile,
  listNewMessagesSince,
  markAsRead,
  type FetchedEmail,
} from "@/lib/email/gmail";
import { detectFileType } from "@/lib/parsers/parseFile";
import { generateRfqCode } from "@/lib/rfq";
import { withRetry } from "@/lib/retry";
import { mapWithConcurrency } from "@/lib/concurrency";

export type SyncResult = {
  created: number;
  fetched: number;
  deduped: number;
  insertFailed: number;
  lastInsertError: string | null;
  results: { rfqCode: string; subject: string; from: string; hasAttachment: boolean }[];
  usedFallback: boolean;
};

const UNIQUE_VIOLATION = "23505";

async function getSetting(supabase: SupabaseClient, userId: string, key: string): Promise<string | null> {
  const { data } = await supabase
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.value ?? null;
}

async function saveSettings(supabase: SupabaseClient, userId: string, kvs: { key: string; value: string }[]) {
  const { error } = await supabase
    .from("user_settings")
    .upsert(kvs.map((kv) => ({ user_id: userId, ...kv })), { onConflict: "user_id,key" });
  if (error) logError("[gmail-sync] could not save settings", { userId, error });
}

export async function syncGmailForUser(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string,
  onProgress?: (processed: number, total: number) => void
): Promise<SyncResult> {
  const lastHistoryId = await getSetting(supabase, userId, "gmail_last_history_id");

  let candidates: FetchedEmail[] = [];
  let usedFallback = false;
  let nextHistoryId: string | null = null;

  if (lastHistoryId) {
    try {
      const hist = await listNewMessagesSince(lastHistoryId, refreshToken);
      if (!hist.expired) {
        candidates = await fetchMessagesByIds(hist.messageIds, refreshToken);
        nextHistoryId = hist.historyId;
      }
    } catch (err) {
      // Transient History API failure — fall back to a full scan rather
      // than losing this sync cycle entirely.
      logError("[gmail-sync] history lookup failed, falling back", err);
    }
  }

  if (nextHistoryId === null) {
    // Bootstrap (first-ever sync) or recovery (historyId expired/errored):
    // bounded scan of unread mail, then re-anchor to the current historyId
    // so every sync after this one goes back to the cheap incremental path.
    usedFallback = true;
    candidates = await fetchUnreadEmails(20, refreshToken);
    const profile = await getGmailProfile(refreshToken);
    nextHistoryId = profile.historyId;
  }

  let created = 0;
  let deduped = 0;
  let insertFailed = 0;
  let lastInsertError: string | null = null;
  const results: SyncResult["results"] = [];

  if (candidates.length > 0) {
    // Batch pre-check — cheaper than one query per message, and narrows the
    // window where two concurrent syncs (cron + manual) could both attempt
    // an insert for the same message (the unique index is the real backstop).
    const { data: existing } = await supabase
      .from("rfqs")
      .select("gmail_message_id")
      .in("gmail_message_id", candidates.map((e) => e.messageId));
    const alreadyImported = new Set((existing ?? []).map((r) => r.gmail_message_id as string));

    for (let i = 0; i < candidates.length; i++) {
      const email = candidates[i];
      onProgress?.(i, candidates.length);

      if (alreadyImported.has(email.messageId)) {
        deduped++;
        try { await markAsRead(email.messageId, refreshToken); } catch { /* best-effort */ }
        continue;
      }

      const supported = email.attachments
        .map((att) => ({ att, type: detectFileType(att.filename, att.mimeType) }))
        .filter((a): a is { att: typeof email.attachments[number]; type: NonNullable<typeof a.type> } => a.type !== null);

      let rawText  = "";
      let fileType: string | null = null;
      const fileName = supported.length > 0 ? supported[0].att.filename : "(email body)";

      if (supported.length === 0 && email.bodyText.trim()) {
        rawText  = email.bodyText;
        fileType = "text";
      } else if (supported.length > 0) {
        fileType = supported.length === 1 ? supported[0].type : "mixed";
      }

      const rfqCode = await generateRfqCode(supabase);
      const { data: rfq, error: insertError } = await supabase
        .from("rfqs")
        .insert({
          user_id:          userId,
          rfq_code:         rfqCode,
          buyer_name:       email.from,
          buyer_email:      email.fromEmail,
          file_name:        fileName,
          file_type:        fileType,
          raw_text:         rawText,
          status:           "pending",
          priority:         /urgent|asap|priority/i.test(email.subject) ? "urgent" : "normal",
          created_at:       email.date.toISOString(),
          gmail_message_id: email.messageId,
          gmail_thread_id:  email.threadId,
        })
        .select("id")
        .single();

      if (insertError || !rfq) {
        // Another sync (cron overlapping a manual fetch) beat us to it —
        // not a real failure, just a dedup race the unique index caught.
        if ((insertError as { code?: string } | null)?.code === UNIQUE_VIOLATION) {
          deduped++;
          try { await markAsRead(email.messageId, refreshToken); } catch { /* best-effort */ }
          continue;
        }
        insertFailed++;
        lastInsertError = insertError?.message ?? "insert returned no row";
        logError("[gmail-sync] rfq insert failed", { messageId: email.messageId, error: insertError });
        continue;
      }

      if (supported.length > 0) {
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
            return { rfq_id: rfq.id, user_id: userId, file_name: att.filename, file_url: path, file_type: type, raw_text: null, status: "pending" };
          } catch (err) {
            logError("[gmail-sync] attachment upload failed", { messageId: email.messageId, filename: att.filename, error: err });
            return { rfq_id: rfq.id, user_id: userId, file_name: att.filename, file_url: null, file_type: type, raw_text: null, status: "pending" };
          }
        });

        const { error: filesError } = await supabase.from("rfq_files").insert(uploadedRows);
        if (filesError) logError("[gmail-sync] rfq_files insert failed", { messageId: email.messageId, error: filesError });
      }

      try { await markAsRead(email.messageId, refreshToken); } catch { /* best-effort */ }

      results.push({ rfqCode, subject: email.subject, from: email.from, hasAttachment: supported.length > 0 });
      created++;
    }
  }

  await saveSettings(supabase, userId, [
    { key: "gmail_last_history_id", value: nextHistoryId },
    { key: "gmail_last_synced_at", value: new Date().toISOString() },
  ]);

  return { created, fetched: candidates.length, deduped, insertFailed, lastInsertError, results, usedFallback };
}
