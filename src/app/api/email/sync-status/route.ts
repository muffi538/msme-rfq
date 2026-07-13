import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lightweight — polled client-side every ~20s to drive the "Last synced"
// indicator and to know when to quietly re-fetch pending RFQs so newly
// arrived mail shows up without the user refreshing the page.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .in("key", ["gmail_last_synced_at", "gmail_refresh_token", "gmail_onboarded", "gmail_needs_reconnect"])
    .order("created_at", { ascending: false });

  const lastSyncedAt = data?.find((r) => r.key === "gmail_last_synced_at")?.value ?? null;
  const connected = !!data?.find((r) => r.key === "gmail_refresh_token")?.value;
  const onboarded = data?.find((r) => r.key === "gmail_onboarded")?.value === "true";
  const needsReconnect = data?.find((r) => r.key === "gmail_needs_reconnect")?.value === "true";

  return NextResponse.json({ lastSyncedAt, connected, onboarded, needsReconnect });
}
