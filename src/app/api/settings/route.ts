import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id);

  const settings: Record<string, string> = {};
  for (const row of data ?? []) settings[row.key] = row.value;
  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json() as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    await supabase
      .from("user_settings")
      .upsert({ user_id: user.id, key, value }, { onConflict: "user_id,key" });
  }

  return NextResponse.json({ ok: true });
}
