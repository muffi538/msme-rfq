import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logError";
import { NextResponse, type NextRequest } from "next/server";

// Redirect with a machine-readable error code, plus a short human-readable
// detail we can actually see in the browser (we have no access to server logs).
function fail(origin: string, code: string, detail?: string) {
  const params = new URLSearchParams({ gmail_error: code });
  if (detail) params.set("detail", detail.slice(0, 300));
  return NextResponse.redirect(`${origin}/inbox?${params.toString()}`);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");

  console.log("[gmail-oauth] callback received", { hasCode: !!code, error });

  if (error || !code) {
    return fail(origin, "access_denied", error ?? undefined);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  console.log("[gmail-oauth] session lookup", { userId: user?.id ?? null });
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      code,
      redirect_uri:  `${origin}/api/auth/gmail/callback`,
      grant_type:    "authorization_code",
    }),
  });

  const tokens = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  console.log("[gmail-oauth] token exchange", {
    status: tokenRes.status,
    hasAccessToken: !!tokens.access_token,
    hasRefreshToken: !!tokens.refresh_token,
    error: tokens.error,
  });

  if (!tokens.refresh_token || !tokens.access_token) {
    // Google omits refresh_token on re-consent for an already-authorized app
    // in some edge cases even with prompt=consent; access_token alone is not
    // enough since we need long-lived access for background fetches.
    const detail = tokens.error
      ? `${tokens.error}: ${tokens.error_description ?? ""}`
      : !tokens.refresh_token
      ? "no refresh_token in response"
      : "no access_token in response";
    logError("[gmail-oauth] token exchange failed", detail);
    return fail(origin, "token_failed", detail);
  }

  // Get the Gmail address for this account
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json() as { email?: string; error?: { message?: string } };

  console.log("[gmail-oauth] profile fetch", { status: profileRes.status, email: profile.email ?? null });

  if (!profileRes.ok || !profile.email) {
    const detail = `status=${profileRes.status} ${profile.error?.message ?? JSON.stringify(profile)}`;
    logError("[gmail-oauth] profile fetch failed", detail);
    return fail(origin, "profile_failed", detail);
  }

  // Save per-user Gmail credentials to user_settings
  const { error: saveError } = await supabase.from("user_settings").upsert(
    [
      { user_id: user.id, key: "gmail_refresh_token", value: tokens.refresh_token },
      { user_id: user.id, key: "gmail_email",         value: profile.email },
    ],
    { onConflict: "user_id,key" }
  );

  console.log("[gmail-oauth] database save", { ok: !saveError, error: saveError?.message });

  if (saveError) {
    logError("[gmail-oauth] failed to save Gmail credentials", saveError);
    return fail(origin, "save_failed", `${saveError.code ?? ""} ${saveError.message}`);
  }

  console.log("[gmail-oauth] success", { userId: user.id, email: profile.email });
  return NextResponse.redirect(`${origin}/inbox?gmail_connected=1`);
}
