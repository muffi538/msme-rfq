import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, getOriginalMessageIdHeader } from "@/lib/email/gmail";
import { logError } from "@/lib/logError";

// Statuses at or past "under evaluation" must never be silently pulled
// back to "quotation_sent" by sending a follow-up/revised quotation on the
// same RFQ — only the forward manual actions in
// src/app/api/rfqs/[id]/status/route.ts move it further.
const STATUSES_PAST_QUOTATION_SENT = ["under_evaluation", "po_received"];

// Finalizes and sends a quotation built via "Import Existing RFQ" (or any
// quotation_replies-linked draft) — distinct from /api/rfq-reply/send,
// which stays untouched and keeps serving the original Screenshot/Upload
// File/Paste Text modes exactly as before. This route additionally: tries
// to reply within the original RFQ's Gmail thread when that RFQ was
// imported from Gmail (falls back to a normal new email otherwise, exactly
// like /api/rfq-reply/send always has), attaches a generated quotation PDF
// when one was uploaded to storage first, and advances rfqs.status.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { quotationReplyId, to, subject, body, attachmentPath } = await request.json() as {
    quotationReplyId: string;
    to: string;
    subject: string;
    body: string;
    attachmentPath?: string | null;
  };

  if (!quotationReplyId || !to || !subject || !body) {
    return NextResponse.json({ error: "quotationReplyId, to, subject and body are required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "Invalid recipient email address" }, { status: 400 });
  }

  const { data: quotationReply } = await supabase
    .from("quotation_replies")
    .select("id, rfq_id, supplier_name")
    .eq("id", quotationReplyId)
    .maybeSingle();
  if (!quotationReply) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });

  const { data: userSettingRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .in("key", ["company_name", "gmail_refresh_token"]);
  const companyName = userSettingRows?.find((r) => r.key === "company_name")?.value ?? "Procur.AI";
  const gmailToken  = userSettingRows?.find((r) => r.key === "gmail_refresh_token")?.value;
  if (!gmailToken) {
    return NextResponse.json({ error: "Gmail not connected. Please connect your Gmail in the inbox." }, { status: 400 });
  }

  // Thread-reply is only attempted when the original RFQ was imported from
  // Gmail (gmail_message_id/gmail_thread_id set on import — see
  // src/lib/email/sync.ts) — a manually-uploaded RFQ has no thread to
  // reply into, and getOriginalMessageIdHeader/sendEmail both already
  // degrade gracefully to a normal new email if anything here comes back
  // empty, so this never blocks the send.
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let rfq: { id: string; status: string } | null = null;
  if (quotationReply.rfq_id) {
    const { data: rfqRow } = await supabase
      .from("rfqs")
      .select("id, status, gmail_message_id, gmail_thread_id")
      .eq("id", quotationReply.rfq_id)
      .maybeSingle();
    if (rfqRow) {
      rfq = { id: rfqRow.id, status: rfqRow.status };
      if (rfqRow.gmail_message_id && rfqRow.gmail_thread_id) {
        const messageIdHeader = await getOriginalMessageIdHeader(rfqRow.gmail_message_id, gmailToken);
        if (messageIdHeader) {
          threadId = rfqRow.gmail_thread_id;
          inReplyTo = messageIdHeader;
        }
      }
    }
  }

  // Best-effort attachment — a storage/download hiccup should never block
  // the buyer from getting the quotation itself; the email still sends
  // (with pricing in the body), just without the attached PDF.
  let attachment: { filename: string; mimeType: string; buffer: Buffer } | undefined;
  if (attachmentPath) {
    const { data: blob, error: downloadError } = await supabase.storage.from("rfq-files").download(attachmentPath);
    if (downloadError) {
      logError("[rfq-reply/quotation/send] attachment download failed (sending without it)", downloadError);
    } else {
      attachment = {
        filename: "Quotation.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await blob.arrayBuffer()),
      };
    }
  }

  try {
    const sendResult = await sendEmail({
      to, subject, body,
      fromName: companyName,
      refreshToken: gmailToken,
      threadId,
      inReplyTo,
      references: inReplyTo,
      attachment,
    });

    const sentAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("quotation_replies")
      .update({
        status: "sent",
        sent_at: sentAt,
        email_subject: subject,
        email_body: body,
        gmail_message_id: sendResult.messageId,
        gmail_thread_id: sendResult.threadId,
      })
      .eq("id", quotationReplyId);
    if (updateError) logError("[rfq-reply/quotation/send] quotation_replies status update failed", updateError);

    if (rfq && !STATUSES_PAST_QUOTATION_SENT.includes(rfq.status)) {
      const { error: statusError } = await supabase.from("rfqs").update({ status: "quotation_sent" }).eq("id", rfq.id);
      if (statusError) logError("[rfq-reply/quotation/send] rfqs status update failed", statusError);
    }

    // Dual-write to buyer_reply_logs so anything still reading it directly
    // (or a pre-migration integration) keeps working — quotation_replies is
    // the source of truth going forward, this is a compatibility mirror.
    const { data: replyItems } = await supabase
      .from("quotation_reply_items")
      .select("name, qty, unit, unit_price, remarks")
      .eq("quotation_reply_id", quotationReplyId)
      .order("line_number");
    const { error: logError_ } = await supabase.from("buyer_reply_logs").insert({
      user_id:       user.id,
      buyer_email:   to.trim(),
      supplier_name: quotationReply.supplier_name ?? null,
      quote_summary: {
        supplier_name: quotationReply.supplier_name ?? null,
        items: (replyItems ?? []).map((it) => ({
          name: it.name, qty: it.qty, unit: it.unit, unit_price: it.unit_price, notes: it.remarks,
        })),
      },
      email_subject: subject,
      email_body:    body,
      sent_at:       sentAt,
    });
    if (logError_) logError("[rfq-reply/quotation/send] buyer_reply_logs mirror insert failed", logError_);

    return NextResponse.json({ ok: true, sentAt, threaded: !!threadId });
  } catch (err: unknown) {
    logError("[rfq-reply/quotation/send] send failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
