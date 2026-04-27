import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type Attachment } from "mailparser";

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

// Connect to Gmail IMAP and fetch unread emails
export async function fetchUnreadEmails(limit = 20): Promise<FetchedEmail[]> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER!,
      pass: process.env.GMAIL_APP_PASSWORD!,
    },
    logger: false,
  });

  await client.connect();

  const emails: FetchedEmail[] = [];

  try {
    await client.mailboxOpen("INBOX");

    // Search for unseen messages
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || uids.length === 0) return [];

    // Take the most recent `limit` messages
    const toFetch = uids.slice(-limit);

    for await (const msg of client.fetch(toFetch, { source: true }, { uid: true })) {
      try {
        if (!msg.source) continue;
        const parsed: ParsedMail = await simpleParser(msg.source as Buffer);

        const attachments = (parsed.attachments ?? [])
          .filter((a: Attachment) => a.content && a.contentType)
          .map((a: Attachment) => ({
            filename: a.filename ?? "attachment",
            mimeType: a.contentType,
            buffer:   a.content as Buffer,
          }));

        const fromAddress = parsed.from?.value?.[0];

        emails.push({
          messageId: parsed.messageId ?? String(msg.uid),
          subject:   parsed.subject ?? "(no subject)",
          from:      fromAddress?.name ?? fromAddress?.address ?? "Unknown",
          fromEmail: fromAddress?.address ?? "",
          date:      parsed.date ?? new Date(),
          bodyText:  parsed.text ?? "",
          attachments,
        });

        // Mark as seen so we don't fetch it again
        await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"], { uid: true });
      } catch {
        // Skip malformed emails
        continue;
      }
    }
  } finally {
    await client.logout();
  }

  return emails;
}
