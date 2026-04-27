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

  if (channel === "whatsapp") {
    // WhatsApp — placeholder (AiSensy API to be wired in Phase 4)
    // For now we log the intent and mark as sent
    console.log(`[WhatsApp] Would send to ${outgoing.suppliers?.whatsapp_number}: ${outgoing.message_body}`);

    await supabase
      .from("outgoing_rfqs")
      .update({ status: "sent", sent_at: new Date().toISOString(), channel: "whatsapp" })
      .eq("id", outgoingId);

    return NextResponse.json({ ok: true, channel: "whatsapp", note: "WhatsApp send queued (AiSensy integration in Phase 4)" });
  }

  if (channel === "email") {
    // Email — placeholder (SMTP to be wired in Phase 4)
    console.log(`[Email] Would send to ${outgoing.suppliers?.email}: ${outgoing.message_body}`);

    await supabase
      .from("outgoing_rfqs")
      .update({ status: "sent", sent_at: new Date().toISOString(), channel: "email" })
      .eq("id", outgoingId);

    return NextResponse.json({ ok: true, channel: "email", note: "Email send queued (SMTP integration in Phase 4)" });
  }

  return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
}
