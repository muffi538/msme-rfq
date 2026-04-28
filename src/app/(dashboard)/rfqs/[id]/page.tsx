import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqDetailClient from "@/components/dashboard/RfqDetailClient";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch RFQ
  const { data: rfq } = await supabase
    .from("rfqs")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!rfq) notFound();

  // Fetch items
  const { data: items } = await supabase
    .from("rfq_items")
    .select("*")
    .eq("rfq_id", id)
    .order("line_number");

  // Fetch outgoing RFQs (splits) with supplier name
  const { data: outgoing } = await supabase
    .from("outgoing_rfqs")
    .select("*, suppliers(name, whatsapp_number, whatsapp_group_link, email)")
    .eq("rfq_id", id)
    .order("category");

  // Fetch outgoing items (to know which items are in each split)
  const { data: outgoingItems } = await supabase
    .from("outgoing_rfq_items")
    .select("outgoing_rfq_id, item_id")
    .in("outgoing_rfq_id", (outgoing ?? []).map((o) => o.id));

  return (
    <>
      <DashboardHeader title={rfq.rfq_code} />
      <RfqDetailClient
        rfq={rfq}
        items={items ?? []}
        outgoing={outgoing ?? []}
        outgoingItems={outgoingItems ?? []}
      />
    </>
  );
}
