import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // "failed" RFQs stay here too (not silently dropped) so the user can see
  // and retry them instead of them disappearing after a failed run.
  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, file_name, created_at, status, process_error")
    .in("status", ["pending", "needs_processing", "processing", "failed"])
    .eq("hidden_from_dashboard", false)
    .order("created_at", { ascending: false, nullsFirst: false });

  return NextResponse.json({ rfqs: rfqs ?? [] });
}
