// Shared core for every Gmail import path — the manual "Fetch Now" button,
// the first-connect onboarding import, "Fetch More History", and the
// every-2-minute cron. All four call the same importCandidateEmails core so
// dedup/insert behave identically no matter which one runs, and all share
// one createGmailSession per call so the OAuth token is only exchanged once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logError";
import { createGmailSession, GmailApiError, type FetchedEmail, type GmailSession } from "@/lib/email/gmail";
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
  needsReconnect?: boolean;
};

const GMAIL_NEEDS_RECONNECT_KEY = "gmail_needs_reconnect";

// A "disconnected"/"permission_revoked" GmailApiError means no amount of
// retrying will ever succeed until the user goes through OAuth again — so
// this flag is what lets the cron stop wasting cycles hitting a known-dead
// connection every 2 minutes, and what lets the UI show a persistent
// "Reconnect Gmail" prompt instead of a one-off toast that disappears.
// Cleared automatically the moment a sync actually succeeds again (either
// because the user reconnected, or the failure turns out to have been
// transient after all) — see the OAuth callback route for the other place
// it's cleared, right after a fresh successful connect.
async function markGmailAuthOutcome(supabase: SupabaseClient, userId: string, err: unknown): Promise<never> {
  if (err instanceof GmailApiError && (err.kind === "disconnected" || err.kind === "permission_revoked")) {
    await saveSettings(supabase, userId, [{ key: GMAIL_NEEDS_RECONNECT_KEY, value: "true" }]);
  }
  throw err;
}

const UNIQUE_VIOLATION = "23505";
const EMPTY: Omit<SyncResult, "usedFallback"> = {
  created: 0, fetched: 0, deduped: 0, insertFailed: 0, lastInsertError: null, results: [],
};

// A single regular sync (cron tick or "Fetch Now") never imports more than
// this many emails, so "Processing X of N" always shows a small N and the
// UI never grinds through a long queue in one request. Anything beyond the
// cap is left queued for the next sync — see syncGmailForUser below for how
// the historyId checkpoint is deliberately withheld in that case so nothing
// past the cap is ever silently skipped. Deliberate large imports
// (onboarding's Last 25/50/100, "Fetch More History") are unaffected — this
// cap only applies to the regular incremental/fallback sync path.
const SYNC_BATCH_CAP = 5;

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
//
// Explicitly scoped to this user's own rows — the cron path calls this with
// a service-role client that bypasses RLS entirely, so without this filter
// one account's sync could "dedupe away" (silently skip importing) a
// message that only collides in Gmail message id with something a
// completely different, unrelated account already imported.
async function filterUnseenMessageIds(supabase: SupabaseClient, userId: string, ids: string[]): Promise<{ unseen: string[]; alreadySeen: number }> {
  if (ids.length === 0) return { unseen: [], alreadySeen: 0 };
  const { data: existing } = await supabase
    .from("rfqs")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .in("gmail_message_id", ids);
  const seen = new Set((existing ?? []).map((r) => r.gmail_message_id as string));
  return { unseen: ids.filter((id) => !seen.has(id)), alreadySeen: seen.size };
}

// Emails are independent of each other — importing one has no bearing on
// importing the next — so this runs several at a time instead of one at a
// time. 5 in flight = the entire per-sync batch cap (SYNC_BATCH_CAP) runs
// fully in parallel, no queueing within a sync. generateRfqCode's rare
// cross-request duplicate-number race under concurrency is an accepted,
// cosmetic-only tradeoff (see its docstring).
const EMAIL_IMPORT_CONCURRENCY = 5;

type EmailOutcome =
  | { kind: "created"; entry: SyncResult["results"][number] }
  | { kind: "deduped" }
  | { kind: "failed"; error: string };

// Every step that can transiently fail (rfq_code generation, the insert
// itself) is retried; and the whole function is wrapped in a catch-all so
// that ANY unexpected failure here — retried out or not — resolves to a
// "failed" outcome instead of throwing out of the worker. mapWithConcurrency
// runs these concurrently via Promise.all, so one worker throwing would
// reject the whole batch and abort every other email still in flight,
// including ones that would have succeeded — exactly what must not happen.
async function importOneEmail(supabase: SupabaseClient, userId: string, session: GmailSession, email: FetchedEmail): Promise<EmailOutcome> {
  try {
    const supported = email.attachments
      .map((att) => ({ att, type: detectFileType(att.filename, att.mimeType) }))
      .filter((a): a is { att: typeof email.attachments[number]; type: NonNullable<typeof a.type> } => a.type !== null);

    const hasBodyText = email.bodyText.trim().length > 0;

    let rawText  = "";
    let fileType: string | null = null;
    const fileName = supported.length > 0 ? supported[0].att.filename : "(email body)";

    if (supported.length === 0 && hasBodyText) {
      // No attachments — the legacy single-blob path (rfqs.raw_text) handles
      // this directly; no rfq_files rows needed at all.
      rawText  = email.bodyText;
      fileType = "text";
    } else if (supported.length > 0) {
      fileType = supported.length === 1 ? supported[0].type : "mixed";
    }

    const rfqCode = await withRetry(
      () => generateRfqCode(supabase, userId),
      { retries: 2, label: `generate rfq code for "${email.subject}"` }
    );

    const { data: rfq, error: insertError } = await withRetry(
      async () => {
        const res = await supabase
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
        // A unique-violation dedup race isn't a transient failure — don't
        // retry it, just hand it back for the caller below to interpret.
        if (res.error && (res.error as { code?: string }).code !== UNIQUE_VIOLATION) throw res.error;
        return res;
      },
      { retries: 2, label: `insert rfq for "${email.subject}"` }
    );

    if (insertError || !rfq) {
      // Another sync (cron overlapping a manual fetch) beat us to it — not a
      // real failure, just a dedup race the unique index caught.
      if ((insertError as { code?: string } | null)?.code === UNIQUE_VIOLATION) return { kind: "deduped" };
      logError("[gmail-sync] rfq insert failed", { messageId: email.messageId, error: insertError });
      return { kind: "failed", error: insertError?.message ?? "insert returned no row" };
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

      // The email's own body text is a real, independent source of RFQ
      // content in its own right — e.g. line items typed directly into the
      // email with a product photo attached separately — and was
      // previously silently dropped whenever there was also at least one
      // attachment: this whole branch only handled attachments, and the
      // body-text branch above only fires when supported.length === 0, so
      // it never ran. Insert it as its own rfq_files row — already parsed
      // (we already have the text, no download/parse step needed) — so the
      // multi-file extraction pipeline treats it as a genuine additional
      // source instead of losing it entirely.
      const bodyRow = hasBodyText
        ? [{
            rfq_id: rfq.id, user_id: userId, file_name: "(email body)",
            file_url: null, file_type: "text", raw_text: email.bodyText,
            status: "parsed", error: null,
          }]
        : [];

      const { error: filesError } = await supabase.from("rfq_files").insert([...uploadedRows, ...bodyRow]);
      if (filesError) logError("[gmail-sync] rfq_files insert failed", { messageId: email.messageId, error: filesError });
    }

    try { await session.markAsRead(email.messageId); } catch { /* best-effort */ }

    return { kind: "created", entry: { rfqCode, subject: email.subject, from: email.from, hasAttachment: supported.length > 0 } };
  } catch (err) {
    logError("[gmail-sync] importOneEmail failed unexpectedly", { messageId: email.messageId, error: err });
    return { kind: "failed", error: err instanceof Error ? err.message : "unknown error" };
  }
}

// Inserts already-filtered candidates. The batch pre-filter upstream
// handles the common dedup case; the unique index on gmail_message_id is
// the backstop if two syncs still race on the same message between the
// filter and insert.
async function importCandidateEmails(
  supabase: SupabaseClient,
  userId: string,
  session: GmailSession,
  candidates: FetchedEmail[],
  onProgress?: (processed: number, total: number) => void
): Promise<Omit<SyncResult, "usedFallback">> {
  if (candidates.length === 0) return { ...EMPTY };

  let processed = 0;
  const outcomes = await mapWithConcurrency(
    candidates,
    EMAIL_IMPORT_CONCURRENCY,
    (email) => importOneEmail(supabase, userId, session, email),
    () => onProgress?.(++processed, candidates.length)
  );

  let created = 0;
  let deduped = 0;
  let insertFailed = 0;
  let lastInsertError: string | null = null;
  const results: SyncResult["results"] = [];

  for (const outcome of outcomes) {
    if (outcome.kind === "created") { created++; results.push(outcome.entry); }
    else if (outcome.kind === "deduped") deduped++;
    else { insertFailed++; lastInsertError = outcome.error; }
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
  const { unseen, alreadySeen } = await filterUnseenMessageIds(supabase, userId, ids);
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

  const needsReconnect = (await getSetting(supabase, userId, GMAIL_NEEDS_RECONNECT_KEY)) === "true";
  if (needsReconnect && !isManual) {
    // Known-dead connection (refresh token revoked/expired, or permission
    // pulled) — don't burn a cron cycle hitting the Gmail API again with
    // credentials that will fail identically every time. Only a fresh OAuth
    // reconnect, or an explicit manual retry, gets past this.
    return { ...EMPTY, usedFallback: false, needsReconnect: true };
  }

  const onboarded = (await getSetting(supabase, userId, "gmail_onboarded")) === "true";
  if (!onboarded && !isManual) {
    // Background cron shouldn't silently import anything before the user
    // has chosen how much history they want — that's the onboarding modal's
    // job. Zero Gmail API calls here, so this returns effectively instantly.
    return { ...EMPTY, usedFallback: false, needsOnboarding: true };
  }

  try {
    const result = await syncGmailForUserInner(supabase, userId, refreshToken, onProgress);
    // A manual retry that actually succeeds proves the connection works
    // again — clear the stale flag instead of leaving a "Reconnect Gmail"
    // prompt showing after the problem is already resolved.
    if (needsReconnect) {
      await supabase.from("user_settings").delete().eq("user_id", userId).eq("key", GMAIL_NEEDS_RECONNECT_KEY);
    }
    return result;
  } catch (err) {
    return markGmailAuthOutcome(supabase, userId, err);
  }
}

async function syncGmailForUserInner(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string,
  onProgress?: (processed: number, total: number) => void
): Promise<SyncResult> {
  const session = await createGmailSession(refreshToken);
  const lastHistoryId = await getSetting(supabase, userId, "gmail_last_history_id");

  let messageIds: string[] = [];
  let usedFallback = false;
  let checkpointed = false;

  if (lastHistoryId) {
    try {
      const hist = await session.listHistorySince(lastHistoryId);
      if (!hist.expired) {
        // Filter to not-yet-imported ids *before* capping to the batch
        // size — history.list keeps returning the exact same full set on
        // every call as long as the checkpoint isn't advanced (see below),
        // so naively slicing the first 5 of the raw list would re-select
        // the same already-imported 5 forever instead of ever reaching the
        // rest of the queue. Filtering first makes each call advance to
        // the next unseen batch.
        const { unseen } = await filterUnseenMessageIds(supabase, userId, hist.messageIds);
        const moreQueued = unseen.length > SYNC_BATCH_CAP;
        messageIds = unseen.slice(0, SYNC_BATCH_CAP);
        if (moreQueued) {
          // More new mail exists than this sync will import — do NOT
          // advance the checkpoint to hist.historyId, or everything past
          // the first 5 would be silently skipped forever (the next sync
          // would only ever look *after* that point). Leaving the
          // checkpoint where it is means the next sync re-lists from the
          // same startHistoryId and re-derives "what's left" via the
          // unseen-filter above.
          await saveSettings(supabase, userId, [{ key: "gmail_last_synced_at", value: new Date().toISOString() }]);
        } else {
          // Caught up — safe to advance all the way to the latest historyId.
          await saveSettings(supabase, userId, [
            { key: "gmail_last_history_id", value: hist.historyId },
            { key: "gmail_last_synced_at", value: new Date().toISOString() },
          ]);
        }
        checkpointed = true;
      }
    } catch (err) {
      // A permanently-dead token (disconnected/permission_revoked) will
      // fail the fallback scan below identically — don't waste a second
      // Gmail API round trip finding that out again, just surface it now.
      if (err instanceof GmailApiError && !err.retryable) throw err;
      // Anything else (rate limit, network blip, unexpected error) is
      // worth trying the fallback scan for rather than losing this sync
      // cycle entirely.
      logError("[gmail-sync] history lookup failed, falling back", err);
    }
  }

  if (!checkpointed) {
    // Bootstrap (first-ever manual sync) or recovery (historyId
    // expired/errored): a small, fast scan of unread mail — not a big
    // backfill. Anyone who wants more history has the onboarding picker or
    // "Fetch More History" for that; this fallback exists purely so a
    // manual "Fetch Now" click still does *something* useful quickly, so it
    // stays small on purpose.
    usedFallback = true;
    // Ask for one more than the cap purely to detect whether more unread
    // mail is waiting beyond this batch — only the first SYNC_BATCH_CAP are
    // actually imported.
    const rawIds = await session.listMessageIds("is:unread in:inbox", { maxResults: SYNC_BATCH_CAP + 1 });
    const moreQueued = rawIds.length > SYNC_BATCH_CAP;
    messageIds = rawIds.slice(0, SYNC_BATCH_CAP);
    if (moreQueued) {
      // Still catching up on unread backlog — don't establish a historyId
      // checkpoint yet, or the rest of the backlog would never be visited.
      // Each import marks its message read, so the very same "is:unread"
      // query naturally excludes it next time — no separate queue/offset
      // needs tracking, the mailbox's own unread flag *is* the queue.
      // gmail_onboarded is still set so the cron doesn't wait on the
      // onboarding picker while this catch-up is in progress.
      await saveSettings(supabase, userId, [
        { key: "gmail_onboarded", value: "true" },
        { key: "gmail_last_synced_at", value: new Date().toISOString() },
      ]);
    } else {
      // Caught up — re-anchor to the current historyId so every sync after
      // this one goes back to the cheap incremental "only new mail" path.
      await checkpoint(supabase, userId, session, true);
    }
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
  try {
    const session = await createGmailSession(refreshToken);
    const ids = count > 0 ? await session.listMessageIds("in:inbox", { maxResults: count }) : [];
    const imported = await fetchAndImport(supabase, userId, session, ids, onProgress);
    await checkpoint(supabase, userId, session, true);
    return { ...imported, usedFallback: false };
  } catch (err) {
    return markGmailAuthOutcome(supabase, userId, err);
  }
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
  try {
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
  } catch (err) {
    return markGmailAuthOutcome(supabase, userId, err);
  }
}
