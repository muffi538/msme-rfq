import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { outgoingId, channel } = await request.json();

  // Load the outgoing RFQ + supplier details
  const { data: outgoing } = await supabase
    .from("outgoing_rfqs")
    .select("*, suppliers(name, whatsapp_number, email)")
    .eq("id", outgoingId)
    .eq("user_id", user.id)
    .single();

  if (!outgoing) return NextResponse.json({ error: "Outgoing RFQ not found" }, { status: 404 });

  if (channel !== "whatsapp" && channel !== "email") {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  // Mark this outgoing as sent
  await supabase
    .from("outgoing_rfqs")
    .update({ status: "sent", sent_at: new Date().toISOString(), channel })
    .eq("id", outgoingId);

  // ── Auto-promote parent RFQ to 'sent' once at least one child has gone out ──
  // Many MSME workflows send to one supplier first and treat that as "sent".
  // We move the parent to 'sent' as soon as any outgoing is dispatched, so
  // it shows up in the Sent filter without the user having to click anything.
  await supabase
    .from("rfqs")
    .update({ status: "sent" })
    .eq("id", rfqId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true, channel, parentMarkedSent: true });
}
