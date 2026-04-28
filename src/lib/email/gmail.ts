export type FetchedEmail = {
  messageId: string;
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

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`OAuth token error: ${data.error ?? "unknown"}`);
  return data.access_token;
}

async function gmailGet(path: string, token: string) {
  const res  = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok || json.error) {
    const err = json.error as { message?: string; status?: string } | undefined;
    throw new Error(`Gmail API error: ${err?.message ?? err?.status ?? res.status}`);
  }
  return json;
}

async function gmailPost(path: string, token: string, body: unknown) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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

export async function fetchUnreadEmails(limit = 5): Promise<FetchedEmail[]> {
  const token = await getAccessToken();

  // Only fetch emails still marked UNREAD — Gmail's own flag is the dedup mechanism.
  // After we save to DB we mark them read, so re-fetching is a no-op.
  const query = `is:unread in:inbox`;

  const listRes = await gmailGet(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
    token
  ) as { messages?: { id: string }[] };

  const messageList = listRes.messages ?? [];
  if (messageList.length === 0) return [];

  const emails: FetchedEmail[] = [];

  for (const { id } of messageList) {
    const msg = await gmailGet(`/messages/${id}?format=full`, token) as {
      id: string;
      payload: GmailPayload;
      internalDate: string;
    };

    const headers  = msg.payload.headers ?? [];
    const subject  = headerVal(headers, "Subject") || "(no subject)";
    const fromRaw  = headerVal(headers, "From");
    // Use Gmail's stable internal id — never the Message-ID header which can contain
    // angle-brackets and break the LIKE dedup check.
    const msgId    = id;

    // Parse "Name <email>" or just "email"
    const emailMatch = fromRaw.match(/<(.+?)>/) ?? fromRaw.match(/(\S+@\S+)/);
    const nameMatch  = fromRaw.match(/^(.+?)\s*</);
    const fromEmail  = emailMatch?.[1] ?? fromRaw;
    const fromName   = nameMatch?.[1]?.replace(/"/g, "") ?? fromEmail;

    const bodyText    = extractBody(msg.payload);
    const attachments = await extractAttachments(id, msg.payload, token);

    emails.push({
      messageId: msgId,
      subject,
      from:      fromName,
      fromEmail,
      date:      new Date(Number(msg.internalDate)),
      bodyText,
      attachments,
    });

    // Mark as read
    await gmailPost(`/messages/${id}/modify`, token, {
      removeLabelIds: ["UNREAD"],
    });
  }

  return emails;
}
