import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Temporary diagnostic endpoint — reports exactly what's stored for the
// logged-in user so we can see ground truth instead of inferring from the UI.
// Safe to hit repeatedly; only returns data scoped to the caller's own
// account (same RLS as everywhere else). Remove once Gmail connect is
// confirmed working end-to-end.
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ loggedIn: false, userError: userError?.message ?? null });
  }

  const { data: rows, error: rowsError } = await supabase
    .from("user_settings")
    .select("id, key, value, created_at, updated_at")
    .eq("user_id", user.id)
    .in("key", ["gmail_email", "gmail_refresh_token"])
    .order("created_at", { ascending: false });

  return NextResponse.json({
    loggedIn: true,
    userId: user.id,
    userEmail: user.email,
    rows: rows?.map((r) => ({
      ...r,
      // Don't leak the actual refresh token — just prove it's non-empty.
      value: r.key === "gmail_refresh_token" && r.value ? `<redacted, length ${r.value.length}>` : r.value,
    })) ?? [],
    rowsError: rowsError?.message ?? null,
  });
}
