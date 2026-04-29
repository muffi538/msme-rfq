import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, file_name, created_at")
    .eq("user_id", user.id)
    .in("status", ["pending", "needs_processing"])
    .order("created_at", { ascending: false, nullsFirst: false });

  return NextResponse.json({ rfqs: rfqs ?? [] });
}
