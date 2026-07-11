import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqDetailClient from "@/components/dashboard/RfqDetailClient";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RFQ, items, and outgoing splits don't depend on each other — fetch in parallel.
  const [{ data: rfq }, { data: items }, { data: outgoing }] = await Promise.all([
    supabase.from("rfqs").select("*").eq("id", id).single(),
    supabase.from("rfq_items").select("*").eq("rfq_id", id).order("line_number"),
    supabase
      .from("outgoing_rfqs")
      .select("*, suppliers(name, whatsapp_number, whatsapp_group_link, email)")
      .eq("rfq_id", id)
      .order("category"),
  ]);

  if (!rfq) notFound();

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
      />
    </>
  );
}
