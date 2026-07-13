import { NextResponse } from "next/server";
import { logError } from "@/lib/logError";
import { createClient } from "@/lib/supabase/server";

// "Delete" on a pending RFQ card is dashboard-only — it must never touch
// Gmail (no trash, no permanent delete, no label changes). The row stays
// in the database with hidden_from_dashboard=true so future syncs still
// recognize it (by its gmail_message_id) and never re-import it; it just
// stops showing up in the app. See /unhide to reverse this.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: rfq } = await supabase.from("rfqs").select("id").eq("id", id).maybeSingle();
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

  const { error } = await supabase
    .from("rfqs")
    .update({ hidden_from_dashboard: true, hidden_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    logError("[rfqs/hide] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
