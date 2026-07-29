import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";

// Manual, forward-only lifecycle checkpoints past "Quotation Sent" — this
// app has no automated signal for "a buyer is evaluating a quote" or "a
// purchase order was actually cut," so both are explicit user actions
// (RfqDetailClient's "Mark Under Evaluation" / "Mark Purchase Order
// Received" buttons), never inferred. FORWARD_FROM enforces that a
// transition can only happen from the status(es) that logically precede
// it, so this can't be used to skip stages or move backward by replaying
// an old request.
const FORWARD_FROM: Record<string, string[]> = {
  under_evaluation: ["quotation_sent"],
  po_received:      ["under_evaluation"],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { status } = await request.json() as { status?: string };
  const allowedFrom = status ? FORWARD_FROM[status] : undefined;
  if (!status || !allowedFrom) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { data: rfq } = await supabase.from("rfqs").select("id, status").eq("id", id).maybeSingle();
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  if (!allowedFrom.includes(rfq.status)) {
    return NextResponse.json(
      { error: `Cannot mark as "${status}" from the current status "${rfq.status}".` },
      { status: 409 }
    );
  }

  const { error } = await supabase.from("rfqs").update({ status }).eq("id", id);
  if (error) {
    logError("[rfqs/status] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
