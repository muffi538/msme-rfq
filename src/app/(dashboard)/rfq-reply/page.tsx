import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqReplyClient from "@/components/dashboard/RfqReplyClient";
import type { ImportableRfq } from "@/components/dashboard/ImportRfqModal";

export default async function RfqReplyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Same scope as the main RFQs list (/rfqs) — every already-processed RFQ
  // is a candidate to import and price, not just ones already dispatched
  // to a supplier.
  const [{ data: rfqs }, { data: outgoingRows }, { data: draftRows }] = await Promise.all([
    supabase
      .from("rfqs")
      .select("id, rfq_code, buyer_name, buyer_email, status, created_at")
      .eq("user_id", user.id)
      .not("status", "in", "(pending,needs_processing)")
      .order("created_at", { ascending: false }),
    supabase
      .from("outgoing_rfqs")
      .select("rfq_id, suppliers(name)")
      .eq("user_id", user.id),
    supabase
      .from("quotation_replies")
      .select("rfq_id")
      .eq("user_id", user.id)
      .eq("status", "draft"),
  ]);

  const supplierNamesByRfq = new Map<string, Set<string>>();
  for (const row of outgoingRows ?? []) {
    const name = (row as unknown as { suppliers: { name: string } | null }).suppliers?.name;
    if (!name) continue;
    const set = supplierNamesByRfq.get(row.rfq_id) ?? new Set<string>();
    set.add(name);
    supplierNamesByRfq.set(row.rfq_id, set);
  }
  const draftRfqIds = new Set((draftRows ?? []).map((d) => d.rfq_id).filter((id): id is string => !!id));

  const importableRfqs: ImportableRfq[] = (rfqs ?? []).map((rfq) => ({
    id: rfq.id,
    rfq_code: rfq.rfq_code,
    buyer_name: rfq.buyer_name,
    buyer_email: rfq.buyer_email,
    status: rfq.status,
    created_at: rfq.created_at,
    supplier_names: [...(supplierNamesByRfq.get(rfq.id) ?? [])],
    has_draft: draftRfqIds.has(rfq.id),
  }));

  return (
    <>
      <DashboardHeader title="RFQ Reply" />
      <main className="flex-1 p-8">
        <RfqReplyClient importableRfqs={importableRfqs} />
      </main>
    </>
  );
}
