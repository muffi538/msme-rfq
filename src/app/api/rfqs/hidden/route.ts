import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lists RFQs hidden from the dashboard via the inbox "Delete" action —
// backs the "Restore Hidden Emails" settings page.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, file_name, hidden_at")
    .eq("hidden_from_dashboard", true)
    .order("hidden_at", { ascending: false });

  return NextResponse.json({ rfqs: rfqs ?? [] });
}
