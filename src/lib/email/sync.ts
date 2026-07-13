// Shared core for every Gmail import path — the manual "Fetch Now" button,
// the first-connect onboarding import, "Fetch More History", and the
// every-2-minute cron. All four call the same importCandidateEmails core so
// dedup/insert behave identically no matter which one runs, and all share
// one createGmailSession per call so the OAuth token is only exchanged once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logError";
import { createGmailSession, type FetchedEmail, type GmailSession } from "@/lib/email/gmail";
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
  needsOnboarding?: boolean;
};

const UNIQUE_VIOLATION = "23505";
const EMPTY: Omit<SyncResult, "usedFallback"> = {
  created: 0, fetched: 0, deduped: 0, insertFailed: 0, lastInsertError: null, results: [],
};

// .limit(1) instead of .single() — a duplicate row for this user_id+key
// would make .single() error out and look like "not connected".
export async function getGmailRefreshToken(supabase: SupabaseClient, userId: string): Promise<string | null> {
  return getSetting(supabase, userId, "gmail_refresh_token");
}

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

async function checkpoint(supabase: SupabaseClient, userId: string, session: GmailSession, markOnboarded: boolean) {
  const profile = await session.getProfile();
  const kvs = [
    { key: "gmail_last_history_id", value: profile.historyId },
    { key: "gmail_last_synced_at", value: new Date().toISOString() },
  ];
  if (markOnboarded) kvs.push({ key: "gmail_onboarded", value: "true" });
  await saveSettings(supabase, userId, kvs);
  return profile.historyId;
}

// Filters out message ids already imported *before* fetching full message
// content — a full fetch downloads the body and every attachment, so
// skipping it for known duplicates is the single biggest cost saver for a
// backfill ("Fetch More History", re-onboarding) where most candidates are
// typically mail we already have.
async function filterUnseenMessageIds(supabase: SupabaseClient, ids: string[]): Promise<{ unseen: string[]; alreadySeen: number }> {
  if (ids.length === 0) return { unseen: [], alreadySeen: 0 };
  const { data: existing } = await supabase
    .from("rfqs")
    .select("gmail_message_id")
    .in("gmail_message_id", ids);
  const seen = new Set((existing ?? []).map((r) => r.gmail_message_id as string));
  return { unseen: ids.filter((id) => !seen.has(id)), alreadySeen: seen.size };
}

// Inserts already-filtered candidates. The batch pre-filter above handles
// the common case; the unique index on gmail_message_id is the backstop if
// two syncs still race on the same message between the filter and insert.
async function importCandidateEmails(
  supabase: SupabaseClient,
  userId: string,
  session: GmailSession,
  candidates: FetchedEmail[],
  onProgress?: (processed: number, total: number) => void
): Promise<Omit<SyncResult, "usedFallback">> {
  let created = 0;
  let deduped = 0;
  let insertFailed = 0;
  let lastInsertError: string | null = null;
  const results: SyncResult["results"] = [];

  if (candidates.length === 0) return { ...EMPTY };

  for (let i = 0; i < candidates.length; i++) {
    const email = candidates[i];
    onProgress?.(i, candidates.length);

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
      // Another sync (cron overlapping a manual fetch) beat us to it — not
      // a real failure, just a dedup race the unique index caught.
      if ((insertError as { code?: string } | null)?.code === UNIQUE_VIOLATION) {
        deduped++;
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

    try { await session.markAsRead(email.messageId); } catch { /* best-effort */ }

    results.push({ rfqCode, subject: email.subject, from: email.from, hasAttachment: supported.length > 0 });
    created++;
  }

  return { created, fetched: candidates.length, deduped, insertFailed, lastInsertError, results };
}

// Filter → fetch full content → insert, in that order, so a full Gmail
// fetch (body + attachments) never happens for a message we already have.
async function fetchAndImport(
  supabase: SupabaseClient,
  userId: string,
  session: GmailSession,
  ids: string[],
  onProgress?: (processed: number, total: number) => void
): Promise<Omit<SyncResult, "usedFallback">> {
  const { unseen, alreadySeen } = await filterUnseenMessageIds(supabase, ids);
  const candidates = await session.fetchMessages(unseen);
  const imported = await importCandidateEmails(supabase, userId, session, candidates, onProgress);
  return { ...imported, fetched: ids.length, deduped: imported.deduped + alreadySeen };
}

// "Fetch Now" (manual) and the every-2-minute cron both call this. Cron
// calls are gated on gmail_onboarded — until the user has picked an import
// size on first connect, cron does nothing (not even a Gmail API call).
// A manual click always runs: if the user hasn't onboarded yet, it falls
// back to a bounded unread scan and that itself counts as onboarding.
export async function syncGmailForUser(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string,
  opts: { onProgress?: (processed: number, total: number) => void; isManual?: boolean } = {}
): Promise<SyncResult> {
  const { onProgress, isManual = false } = opts;

  const onboarded = (await getSetting(supabase, userId, "gmail_onboarded")) === "true";
  if (!onboarded && !isManual) {
    // Background cron shouldn't silently import anything before the user
    // has chosen how much history they want — that's the onboarding modal's
    // job. Zero Gmail API calls here, so this returns effectively instantly.
    return { ...EMPTY, usedFallback: false, needsOnboarding: true };
  }

  const session = await createGmailSession(refreshToken);
  const lastHistoryId = await getSetting(supabase, userId, "gmail_last_history_id");

  let messageIds: string[] = [];
  let usedFallback = false;
  let checkpointed = false;

  if (lastHistoryId) {
    try {
      const hist = await session.listHistorySince(lastHistoryId);
      if (!hist.expired) {
        messageIds = hist.messageIds;
        await saveSettings(supabase, userId, [
          { key: "gmail_last_history_id", value: hist.historyId },
          { key: "gmail_last_synced_at", value: new Date().toISOString() },
        ]);
        checkpointed = true;
      }
    } catch (err) {
      // Transient History API failure — fall back to a full scan rather
      // than losing this sync cycle entirely.
      logError("[gmail-sync] history lookup failed, falling back", err);
    }
  }

  if (!checkpointed) {
    // Bootstrap (first-ever manual sync) or recovery (historyId
    // expired/errored): a small, fast scan of unread mail — not a big
    // backfill. Anyone who wants more history has the onboarding picker or
    // "Fetch More History" for that; this fallback exists purely so a
    // manual "Fetch Now" click still does *something* useful quickly, so it
    // stays small on purpose. Re-anchors to the current historyId
    // afterward so every sync after this one goes back to the cheap
    // incremental "only new mail" path.
    usedFallback = true;
    messageIds = await session.listMessageIds("is:unread in:inbox", { maxResults: 5 });
    await checkpoint(supabase, userId, session, true);
  }

  // If there's genuinely nothing new, this returns instantly — no full
  // message fetch is even attempted for an empty id list.
  const imported = await fetchAndImport(supabase, userId, session, messageIds, onProgress);
  return { ...imported, usedFallback };
}

// First-connect onboarding: user picks Last 25/50/100 (or 0 to skip
// history and only get mail from now on). Always establishes the
// historyId checkpoint and marks onboarding done, regardless of count, so
// the cron can take over immediately afterward.
export async function bootstrapGmailSync(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string,
  count: 0 | 25 | 50 | 100,
  onProgress?: (processed: number, total: number) => void
): Promise<SyncResult> {
  const session = await createGmailSession(refreshToken);

  const ids = count > 0 ? await session.listMessageIds("in:inbox", { maxResults: count }) : [];
  const imported = await fetchAndImport(supabase, userId, session, ids, onProgress);
  await checkpoint(supabase, userId, session, true);
  return { ...imported, usedFallback: false };
}

export type FetchMoreMode = "50" | "100" | "30days";

// "Fetch More History" — an explicit, on-demand backfill separate from the
// regular incremental cursor. Deliberately does NOT touch
// gmail_last_history_id: it must never disturb the ongoing cron's
// checkpoint, only add older mail the incremental sync would never reach.
export async function fetchMoreHistory(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string,
  mode: FetchMoreMode,
  onProgress?: (processed: number, total: number) => void
): Promise<SyncResult> {
  const session = await createGmailSession(refreshToken);

  let query = "in:inbox";
  let maxResults = 50;
  let maxPages = 1;
  if (mode === "100") {
    maxResults = 100;
    maxPages = 1;
  } else if (mode === "30days") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const y = since.getFullYear();
    const m = String(since.getMonth() + 1).padStart(2, "0");
    const d = String(since.getDate()).padStart(2, "0");
    query = `in:inbox after:${y}/${m}/${d}`;
    maxResults = 300; // bounded — a runaway 30-day backfill on a busy inbox shouldn't take down the request
    maxPages = 3;
  }

  const ids = await session.listMessageIds(query, { maxResults, maxPages });
  const imported = await fetchAndImport(supabase, userId, session, ids, onProgress);

  // Still worth bumping last_synced_at — this was a real sync from the
  // user's point of view — but the historyId checkpoint stays untouched.
  await saveSettings(supabase, userId, [{ key: "gmail_last_synced_at", value: new Date().toISOString() }]);

  return { ...imported, usedFallback: false };
}
