import { mapWithConcurrency } from "@/lib/concurrency";
import { withRetry } from "@/lib/retry";

// Every Gmail/OAuth failure gets classified into one of these instead of a
// generic Error — this is what lets callers show "Gmail disconnected,
// please reconnect" instead of a raw "Unauthorized"/"invalid_grant" string,
// and what lets the retry layer below distinguish "this will never succeed
// no matter how many times we try" (revoked/expired credentials) from
// "this will probably succeed on the next attempt" (a rate limit or a
// momentary network/API blip).
export type GmailErrorKind =
  | "token_expired"        // access token rejected mid-use
  | "permission_revoked"   // scope/consent revoked in the user's Google account
  | "disconnected"         // refresh token itself is dead — invalid_grant
  | "network_error"        // request never reached Google, or timed out
  | "api_unavailable"      // Google's side returned a 5xx
  | "rate_limited"         // 429 — real, but should succeed shortly after backing off
  | "unknown";

export class GmailApiError extends Error {
  constructor(message: string, public kind: GmailErrorKind, public retryable: boolean) {
    super(message);
    this.name = "GmailApiError";
  }
}

// Encodes the kind into the message itself (as a bracketed prefix) so it
// survives being passed around as a plain string — e.g. into jobs.error,
// which is just a text column — without needing a schema change. Frontend
// code strips this prefix before displaying the message and uses it to
// decide whether to show a "Reconnect Gmail" action.
function taggedMessage(kind: GmailErrorKind, message: string): string {
  return `[${kind}] ${message}`;
}

export type FetchedEmail = {
  messageId: string;
  threadId:  string;
  subject:   string;
  from:      string;
  fromEmail: string;
  date:      Date;
  bodyText:  string;
  attachments: {
    filename: string;
    mimeType: string;
    buffer:   Buffer;
  }[];
};

const API_TIMEOUT_MS = 15000;

// Only retry failures that are plausibly transient — retrying a revoked
// refresh token or a denied permission just burns time before failing
// identically anyway, and delays the user seeing the real "reconnect
// Gmail" message they actually need.
function isRetryableGmailError(err: unknown): boolean {
  return err instanceof GmailApiError ? err.retryable : true;
}

async function getAccessTokenOnce(refreshToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new GmailApiError(
      taggedMessage("network_error", timedOut ? "Timed out reaching Google's OAuth server." : "Network error while reaching Google's OAuth server."),
      "network_error",
      true
    );
  }

  const data = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (data.access_token) return data.access_token;

  if (data.error === "invalid_grant") {
    // The one truly permanent failure — the refresh token itself is dead
    // (revoked in the user's Google account, or expired from prolonged
    // disuse). No amount of retrying fixes this; only reconnecting does.
    throw new GmailApiError(
      taggedMessage("disconnected", "Gmail disconnected — access was revoked or has expired. Please reconnect your Gmail account."),
      "disconnected",
      false
    );
  }
  if (res.status === 429) {
    throw new GmailApiError(taggedMessage("rate_limited", "Google's OAuth service is rate-limiting requests."), "rate_limited", true);
  }
  if (res.status >= 500) {
    throw new GmailApiError(taggedMessage("api_unavailable", "Google's OAuth service is temporarily unavailable."), "api_unavailable", true);
  }
  throw new GmailApiError(
    taggedMessage("unknown", `Could not refresh Gmail access (${data.error ?? res.status}: ${data.error_description ?? "unknown reason"}).`),
    "unknown",
    false
  );
}

async function getAccessToken(refreshToken: string): Promise<string> {
  return withRetry(() => getAccessTokenOnce(refreshToken), {
    retries: 2,
    label: "Gmail OAuth token refresh",
    isRetryable: isRetryableGmailError,
  });
}

function classifyGmailHttpError(status: number, message: string): GmailApiError {
  if (status === 401) {
    return new GmailApiError(taggedMessage("token_expired", "Gmail access was rejected — the connection may have expired."), "token_expired", false);
  }
  if (status === 403) {
    return new GmailApiError(
      taggedMessage("permission_revoked", "Gmail permission was denied — access may have been revoked. Please reconnect your Gmail account."),
      "permission_revoked",
      false
    );
  }
  if (status === 429) {
    return new GmailApiError(taggedMessage("rate_limited", "Gmail API rate limit reached."), "rate_limited", true);
  }
  if (status >= 500) {
    return new GmailApiError(taggedMessage("api_unavailable", "Gmail API is temporarily unavailable."), "api_unavailable", true);
  }
  return new GmailApiError(taggedMessage("unknown", `Gmail API error (${status}): ${message}`), "unknown", false);
}

async function gmailFetchOnce(url: string, token: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new GmailApiError(
      taggedMessage("network_error", timedOut ? "Timed out reaching the Gmail API." : "Network error while reaching the Gmail API."),
      "network_error",
      true
    );
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || json.error) {
    const err = json.error as { message?: string; status?: string } | undefined;
    throw classifyGmailHttpError(res.status, err?.message ?? err?.status ?? res.statusText);
  }
  return json;
}

// Exponential backoff (via withRetry) covers both real rate limiting (429)
// and momentary Gmail API/network blips (5xx, timeouts) — deliberately not
// parsing Gmail's Retry-After header for a tighter wait, since a fixed
// backoff schedule is simpler to reason about and Gmail's own limits are
// generous enough that the difference rarely matters in practice.
async function gmailGet(path: string, token: string) {
  return withRetry(
    () => gmailFetchOnce(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, token),
    { retries: 2, label: `Gmail API GET ${path}`, isRetryable: isRetryableGmailError }
  );
}

async function gmailPost(path: string, token: string, body: unknown) {
  return withRetry(
    () => gmailFetchOnce(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { retries: 2, label: `Gmail API POST ${path}`, isRetryable: isRetryableGmailError }
  );
}

function decodeBase64(s: string): Buffer {
  // Gmail uses URL-safe base64; Node needs standard base64 + padding
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function headerVal(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: GmailPayload): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data).toString("utf-8");
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  return "";
}

type GmailPayload = {
  mimeType: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPayload[];
  filename?: string;
};

async function extractAttachments(
  messageId: string,
  payload: GmailPayload,
  token: string
): Promise<FetchedEmail["attachments"]> {
  const results: FetchedEmail["attachments"] = [];

  async function walk(p: GmailPayload) {
    if (p.filename && p.filename.length > 0) {
      let buffer: Buffer | null = null;

      if (p.body?.attachmentId) {
        // Large attachment — fetched separately
        const attData = await gmailGet(
          `/messages/${messageId}/attachments/${p.body.attachmentId}`,
          token
        ) as { data?: string };
        if (attData.data) buffer = decodeBase64(attData.data);
      } else if (p.body?.data) {
        // Small attachment — data is inline in the payload
        buffer = decodeBase64(p.body.data);
      }

      if (buffer && buffer.length > 0) {
        results.push({ filename: p.filename, mimeType: p.mimeType, buffer });
      }
    }
    for (const part of p.parts ?? []) await walk(part);
  }

  await walk(payload);
  return results;
}

export async function sendEmail({
  to,
  subject,
  body,
  fromName,
  refreshToken,
}: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  refreshToken: string;
}): Promise<void> {
  const token = await getAccessToken(refreshToken);

  const fromLine = fromName ? `From: ${fromName}\r\n` : "";
  const raw = [
    fromLine,
    `To: ${to}\r\n`,
    `Subject: ${subject}\r\n`,
    `MIME-Version: 1.0\r\n`,
    `Content-Type: text/plain; charset=UTF-8\r\n`,
    `\r\n`,
    body,
  ].join("");

  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await gmailPost("/messages/send", token, { raw: encoded });
}

async function fetchMessageById(id: string, token: string): Promise<FetchedEmail> {
  const msg = await gmailGet(`/messages/${id}?format=full`, token) as {
    id: string;
    threadId: string;
    payload: GmailPayload;
    internalDate: string;
  };

  const headers  = msg.payload.headers ?? [];
  const subject  = headerVal(headers, "Subject") || "(no subject)";
  const fromRaw  = headerVal(headers, "From");

  // Parse "Name <email>" or just "email"
  const emailMatch = fromRaw.match(/<(.+?)>/) ?? fromRaw.match(/(\S+@\S+)/);
  const nameMatch  = fromRaw.match(/^(.+?)\s*</);
  const fromEmail  = emailMatch?.[1] ?? fromRaw;
  const fromName   = nameMatch?.[1]?.replace(/"/g, "") ?? fromEmail;

  const bodyText    = extractBody(msg.payload);
  const attachments = await extractAttachments(id, msg.payload, token);

  return {
    // Use Gmail's stable internal id — never the Message-ID header which can
    // contain angle-brackets and break dedup matching.
    messageId: msg.id,
    threadId:  msg.threadId,
    subject,
    from:      fromName,
    fromEmail,
    date:      new Date(Number(msg.internalDate)),
    bodyText,
    attachments,
  };
}

async function listMessageIds(
  token: string,
  query: string,
  opts: { maxResults?: number; maxPages?: number } = {}
): Promise<string[]> {
  const maxResults = opts.maxResults ?? 5;
  const maxPages    = opts.maxPages ?? 5;
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const remaining = maxResults - ids.length;
    if (remaining <= 0) break;
    const qs = new URLSearchParams({ q: query, maxResults: String(Math.min(100, remaining)) });
    if (pageToken) qs.set("pageToken", pageToken);

    const res = await gmailGet(`/messages?${qs}`, token) as { messages?: { id: string }[]; nextPageToken?: string };
    ids.push(...(res.messages ?? []).map((m) => m.id));
    pageToken = res.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);

  return ids.slice(0, maxResults);
}

// Bounded concurrency — fetching full message bodies (+ any attachments) is
// the slowest part of a sync, so this is the highest-value place to
// parallelize. 5 in flight is comfortably under Gmail's per-user rate limit
// while still being several times faster than fetching one at a time.
async function fetchMessages(token: string, ids: string[], concurrency = 5): Promise<FetchedEmail[]> {
  if (ids.length === 0) return [];
  const results = await mapWithConcurrency(ids, concurrency, async (id) => {
    try {
      return await fetchMessageById(id, token);
    } catch (err) {
      // A message referenced by a list/history call can have been deleted
      // since (e.g. the user trashed it seconds later) — 404s on the
      // individual GET are expected and shouldn't abort the whole batch.
      if (err instanceof Error && /\(404\)/.test(err.message)) return null;
      throw err;
    }
  });
  const emails = results.filter((e): e is FetchedEmail => e !== null);
  emails.sort((a, b) => b.date.getTime() - a.date.getTime());
  return emails;
}

async function getProfile(token: string): Promise<{ historyId: string; emailAddress: string }> {
  const profile = await gmailGet(`/profile`, token) as { historyId?: string; emailAddress?: string };
  if (!profile.historyId) throw new Error("Gmail profile did not return a historyId");
  return { historyId: profile.historyId, emailAddress: profile.emailAddress ?? "" };
}

type HistoryPage = {
  history?: { messagesAdded?: { message: { id: string } }[] }[];
  historyId?: string;
  nextPageToken?: string;
};

// Internal-only sentinel — 404 from history.list means "this historyId no
// longer exists" (Gmail garbage-collects history after ~7 days), a real and
// permanent-for-this-call outcome, never something to retry or surface as
// a GmailApiError.
class HistoryExpiredSignal extends Error {}

async function fetchHistoryPageOnce(token: string, qs: URLSearchParams): Promise<HistoryPage> {
  let res: Response;
  try {
    res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new GmailApiError(
      taggedMessage("network_error", timedOut ? "Timed out reaching the Gmail API." : "Network error while reaching the Gmail API."),
      "network_error",
      true
    );
  }
  if (res.status === 404) throw new HistoryExpiredSignal();

  const json = await res.json().catch(() => ({})) as HistoryPage & { error?: { message?: string; status?: string } };
  if (!res.ok || json.error) {
    throw classifyGmailHttpError(res.status, json.error?.message ?? json.error?.status ?? res.statusText);
  }
  return json;
}

async function fetchHistoryPage(token: string, qs: URLSearchParams): Promise<HistoryPage> {
  return withRetry(() => fetchHistoryPageOnce(token, qs), {
    retries: 2,
    label: "Gmail history.list",
    isRetryable: (err) => (err instanceof HistoryExpiredSignal ? false : isRetryableGmailError(err)),
  });
}

// Incremental sync via the History API: cheap compared to scanning the
// whole inbox, since Gmail only returns what changed since startHistoryId.
// Returns expired:true when Gmail has already garbage-collected that
// history point (typically after ~7 days) — the caller must fall back to a
// full scan and re-establish a fresh baseline historyId in that case.
async function listHistorySince(
  token: string,
  startHistoryId: string
): Promise<{ expired: true } | { expired: false; messageIds: string[]; historyId: string }> {
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;

  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
    });
    if (pageToken) qs.set("pageToken", pageToken);

    let json: HistoryPage;
    try {
      json = await fetchHistoryPage(token, qs);
    } catch (err) {
      if (err instanceof HistoryExpiredSignal) return { expired: true };
      throw err;
    }

    for (const h of json.history ?? []) {
      for (const added of h.messagesAdded ?? []) messageIds.add(added.message.id);
    }
    if (json.historyId) latestHistoryId = json.historyId;
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { expired: false, messageIds: [...messageIds], historyId: latestHistoryId };
}

async function markAsRead(messageId: string, token: string): Promise<void> {
  await gmailPost(`/messages/${messageId}/modify`, token, { removeLabelIds: ["UNREAD"] });
}

export type GmailSession = {
  listMessageIds(query: string, opts?: { maxResults?: number; maxPages?: number }): Promise<string[]>;
  fetchMessages(ids: string[], concurrency?: number): Promise<FetchedEmail[]>;
  getProfile(): Promise<{ historyId: string; emailAddress: string }>;
  listHistorySince(startHistoryId: string): Promise<{ expired: true } | { expired: false; messageIds: string[]; historyId: string }>;
  markAsRead(messageId: string): Promise<void>;
};

// Resolves the OAuth access token exactly once and binds every Gmail call
// in the session to it, instead of every helper independently exchanging
// the refresh token (each a ~100-300ms round trip to Google). A single
// sync cycle can make history + profile + a dozen message calls — batching
// the token exchange is the single biggest latency win available here.
export async function createGmailSession(refreshToken: string): Promise<GmailSession> {
  const token = await getAccessToken(refreshToken);
  return {
    listMessageIds: (query, opts) => listMessageIds(token, query, opts),
    fetchMessages:  (ids, concurrency) => fetchMessages(token, ids, concurrency),
    getProfile:     () => getProfile(token),
    listHistorySince: (startHistoryId) => listHistorySince(token, startHistoryId),
    markAsRead:     (messageId) => markAsRead(messageId, token),
  };
}
