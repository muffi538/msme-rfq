import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export async function GET() {
  // 1. Check that the calling user is an admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Use service role key to read auth.users (bypasses RLS)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Settings → Environment Variables." },
      { status: 500 }
    );
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { users }, error } = await admin.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 3. Get per-user counts (rfqs and suppliers)
  const { data: rfqCounts } = await admin
    .from("rfqs")
    .select("user_id");

  const { data: supplierCounts } = await admin
    .from("suppliers")
    .select("user_id");

  // 4. Get profiles (is_admin flags)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, is_admin");

  const profileMap = new Map((profiles ?? []).map((p: { id: string; is_admin: boolean }) => [p.id, p.is_admin]));

  const rfqMap = new Map<string, number>();
  for (const r of rfqCounts ?? []) {
    rfqMap.set(r.user_id, (rfqMap.get(r.user_id) ?? 0) + 1);
  }

  const supplierMap = new Map<string, number>();
  for (const s of supplierCounts ?? []) {
    supplierMap.set(s.user_id, (supplierMap.get(s.user_id) ?? 0) + 1);
  }

  const result = users.map((u) => ({
    id:              u.id,
    email:           u.email,
    created_at:      u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    confirmed:       !!u.confirmed_at,
    is_admin:        profileMap.get(u.id) ?? false,
    rfq_count:       rfqMap.get(u.id) ?? 0,
    supplier_count:  supplierMap.get(u.id) ?? 0,
  }));

  return NextResponse.json({ users: result });
}
