import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqDetailClient from "@/components/dashboard/RfqDetailClient";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RFQ, items, outgoing splits, and images don't depend on each other — fetch in parallel.
  const [{ data: rfq }, { data: items }, { data: outgoing }, { data: images }] = await Promise.all([
    supabase.from("rfqs").select("*").eq("id", id).single(),
    supabase.from("rfq_items").select("*").eq("rfq_id", id).order("line_number"),
    supabase
      .from("outgoing_rfqs")
      .select("*, suppliers(name, whatsapp_number, whatsapp_group_link, email)")
      .eq("rfq_id", id)
      .order("category"),
    supabase.from("rfq_item_images").select("*").eq("rfq_id", id).order("created_at"),
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

  // outgoingItems depends on outgoing's ids; buyerLog depends on rfq.buyer_email —
  // neither depends on the other, so run them together.
  const [{ data: outgoingItems }, buyerLog] = await Promise.all([
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
  ]);

  const outgoingStats = {
    total: (outgoing ?? []).length,
    sent:  (outgoing ?? []).filter((o) => o.status === "sent").length,
  };

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
        itemImages={itemImages}
      />
    </>
  );
}
