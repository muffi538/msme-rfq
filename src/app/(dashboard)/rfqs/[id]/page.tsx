import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqDetailClient from "@/components/dashboard/RfqDetailClient";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RFQ, items, outgoing splits, images, and source files don't depend on each other — fetch in parallel.
  const [{ data: rfq }, { data: items }, { data: outgoing }, { data: images }, { data: files }] = await Promise.all([
    supabase.from("rfqs").select("*").eq("id", id).single(),
    supabase.from("rfq_items").select("*").eq("rfq_id", id).order("line_number"),
    supabase
      .from("outgoing_rfqs")
      .select("*, suppliers(name, whatsapp_number, whatsapp_group_link, email)")
      .eq("rfq_id", id)
      .order("category"),
    supabase.from("rfq_item_images").select("*").eq("rfq_id", id).order("created_at"),
    supabase.from("rfq_files").select("id, file_name, file_type, status, error, created_at").eq("rfq_id", id).order("created_at"),
  ]);

  if (!rfq) notFound();

  // The rfq-files storage bucket is private — turn each stored path into a
  // short-lived signed URL for display. Best-effort: a signing failure just
  // means that one thumbnail doesn't render, not a page error.
  const itemImages = await Promise.all(
    (images ?? []).map(async (img) => {
      const { data: signed } = await supabase.storage.from("rfq-files").createSignedUrl(img.file_url, 3600);
      return { ...img, signedUrl: signed?.signedUrl ?? null };
    })
  );

  // outgoingItems depends on outgoing's ids; buyerLog depends on rfq.buyer_email;
  // quotationReplies is the real rfq_id-linked replacement for buyerLog's
  // email-string matching (see matchQuotationReply in rfq-lifecycle.ts) —
  // none of the three depend on each other, so run them together.
  const [{ data: outgoingItems }, buyerLog, { data: quotationReplies }] = await Promise.all([
    supabase
      .from("outgoing_rfq_items")
      .select("outgoing_rfq_id, item_id")
      .in("outgoing_rfq_id", (outgoing ?? []).map((o) => o.id)),
    rfq.buyer_email
      ? supabase
          .from("buyer_reply_logs")
          .select("id, buyer_email, supplier_name, quote_summary, email_subject, email_body, sent_at")
          .ilike("buyer_email", rfq.buyer_email.trim())
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    supabase
      .from("quotation_replies")
      .select("id, rfq_id, status, buyer_email, supplier_name, email_subject, email_body, grand_total, sent_at")
      .eq("rfq_id", id)
      .eq("status", "sent")
      .order("sent_at", { ascending: false }),
  ]);

  const outgoingStats = {
    total: (outgoing ?? []).length,
    sent:  (outgoing ?? []).filter((o) => o.status === "sent").length,
  };

  // Most recent sent quotation reply linked to THIS rfq — unambiguous,
  // unlike buyerLog's email matching. Load its line items too, since
  // RfqLifecycleExpand shows full pricing detail for the linked case.
  const latestQuotationReply = (quotationReplies ?? [])[0] ?? null;
  const { data: quotationItems } = latestQuotationReply
    ? await supabase
        .from("quotation_reply_items")
        .select("name, qty, unit, unit_price, brand_offered")
        .eq("quotation_reply_id", latestQuotationReply.id)
        .order("line_number")
    : { data: [] };

  return (
    <>
      <DashboardHeader title={rfq.rfq_code} />
      <RfqDetailClient
        rfq={rfq}
        items={items ?? []}
        outgoing={outgoing ?? []}
        outgoingItems={outgoingItems ?? []}
        outgoingStats={outgoingStats}
        buyerLog={buyerLog}
        quotationReply={latestQuotationReply}
        quotationItems={quotationItems ?? []}
        itemImages={itemImages}
        files={files ?? []}
      />
    </>
  );
}
