import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuyerReplyLog, QuotationReplySummary } from "@/lib/rfq-lifecycle";

type RfqImageRow = {
  id: string; item_id: string | null; file_url: string;
  source_file_name: string | null; match_confidence: number | null;
  category: string | null; brand: string | null; comment: string | null;
};

// Client-side port of the exact fetch logic in
// src/app/(dashboard)/rfqs/[id]/page.tsx — used by the multi-RFQ workspace,
// which needs to load several RFQs' full detail into browser state instead
// of relying on one server-rendered page per RFQ.
export async function fetchRfqDetail(supabase: SupabaseClient, id: string) {
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

  if (!rfq) throw new Error("RFQ not found");

  const itemImages = await Promise.all(
    ((images ?? []) as RfqImageRow[]).map(async (img) => {
      const { data: signed } = await supabase.storage.from("rfq-files").createSignedUrl(img.file_url, 3600);
      return { ...img, signedUrl: signed?.signedUrl ?? null };
    })
  );

  const [{ data: outgoingItems }, buyerLog, { data: quotationReplies }] = await Promise.all([
    supabase
      .from("outgoing_rfq_items")
      .select("outgoing_rfq_id, item_id")
      .in("outgoing_rfq_id", (outgoing ?? []).map((o: { id: string }) => o.id)),
    rfq.buyer_email
      ? supabase
          .from("buyer_reply_logs")
          .select("id, buyer_email, supplier_name, quote_summary, email_subject, email_body, sent_at")
          .ilike("buyer_email", rfq.buyer_email.trim())
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: { data: BuyerReplyLog | null }) => r.data)
      : Promise.resolve(null as BuyerReplyLog | null),
    supabase
      .from("quotation_replies")
      .select("id, rfq_id, status, buyer_email, supplier_name, email_subject, email_body, grand_total, sent_at")
      .eq("rfq_id", id)
      .eq("status", "sent")
      .order("sent_at", { ascending: false }),
  ]);

  const outgoingStats = {
    total: (outgoing ?? []).length,
    sent:  (outgoing ?? []).filter((o: { status: string }) => o.status === "sent").length,
  };

  const latestQuotationReply: QuotationReplySummary | null = (quotationReplies ?? [])[0] ?? null;
  const { data: quotationItems } = latestQuotationReply
    ? await supabase
        .from("quotation_reply_items")
        .select("name, qty, unit, unit_price, brand_offered")
        .eq("quotation_reply_id", latestQuotationReply.id)
        .order("line_number")
    : { data: [] };

  return {
    rfq,
    items: items ?? [],
    outgoing: outgoing ?? [],
    outgoingItems: outgoingItems ?? [],
    outgoingStats,
    buyerLog,
    quotationReply: latestQuotationReply,
    quotationItems: quotationItems ?? [],
    itemImages,
    files: files ?? [],
  };
}
