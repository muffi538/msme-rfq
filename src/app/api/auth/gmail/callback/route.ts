import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logError";
import { NextResponse, type NextRequest } from "next/server";
import { createGmailSession } from "@/lib/email/gmail";
import { createJob, updateJob } from "@/lib/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

// Redirect with a machine-readable error code, plus a short human-readable
// detail we can actually see in the browser (we have no access to server logs).
function fail(origin: string, code: string, detail?: string) {
  const params = new URLSearchParams({ gmail_error: code });
  if (detail) params.set("detail", detail.slice(0, 300));
  return NextResponse.redirect(`${origin}/inbox?${params.toString()}`);
}

type HealthCheckResult = { ok: true } | { ok: false; step: string; detail: string };

// Runs once, right after a Gmail account is connected — every step a real
// sync will later depend on, exercised up front instead of waiting for the
// first automatic sync (or worse, the user's first "Process it" click) to
// discover a broken connection. Any failure here means the account is
// connected in name only, so the caller deletes the credentials just saved
// rather than leaving a half-working "Connected" state in the UI.
async function runGmailHealthCheck(supabase: SupabaseClient, userId: string, refreshToken: string): Promise<HealthCheckResult> {
  // 1 & 2: refresh token exchange + Gmail API access. createGmailSession
  // does the token exchange itself; getProfile is the cheapest real Gmail
  // API call that proves the token actually has API access.
  let session;
  try {
    session = await createGmailSession(refreshToken);
    await session.getProfile();
  } catch (err) {
    return { ok: false, step: "gmail_api", detail: err instanceof Error ? err.message : "Could not reach the Gmail API with this account's token." };
  }

  // 3: read permission + message/attachment access — list+fetch one real
  // message if the inbox isn't empty, the same code path real imports use.
  try {
    const ids = await session.listMessageIds("in:inbox", { maxResults: 1 });
    if (ids.length > 0) await session.fetchMessages(ids);
  } catch (err) {
    return { ok: false, step: "gmail_read", detail: err instanceof Error ? err.message : "Could not read messages from this Gmail account." };
  }

  // 4: DB write/read — read back the credentials just written, under this
  // user's own RLS-scoped client, to confirm the round trip actually works.
  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "gmail_refresh_token")
      .limit(1);
    if (error) throw error;
    if (!data?.[0]?.value) throw new Error("Wrote the Gmail token but couldn't read it back.");
  } catch (err) {
    return { ok: false, step: "db_readwrite", detail: err instanceof Error ? err.message : "Database read/write check failed." };
  }

  // 5: queue processing — the jobs table backs every background sync/import;
  // create-then-complete a throwaway job to confirm it's actually writable.
  try {
    const { job, error } = await createJob(supabase, userId, "health_check");
    if (error || !job) throw new Error(error ?? "Could not create a job.");
    await updateJob(supabase, job.id, { status: "done" });
  } catch (err) {
    return { ok: false, step: "queue", detail: err instanceof Error ? err.message : "Job queue check failed." };
  }

  return { ok: true };
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

  // Production hardening: validate the connection end-to-end right now,
  // rather than finding out it's broken on the first automatic sync (or the
  // user's first "Process it" click, hours or days later). A failure here
  // means the account isn't usably connected, so the credentials just saved
  // are rolled back — no half-working "Connected" state left behind.
  const health = await runGmailHealthCheck(supabase, user.id, tokens.refresh_token);
  console.log("[gmail-oauth] health check", health);

  if (!health.ok) {
    await supabase
      .from("user_settings")
      .delete()
      .eq("user_id", user.id)
      .in("key", ["gmail_refresh_token", "gmail_email"]);
    logError("[gmail-oauth] health check failed, rolled back credentials", health);
    return fail(origin, `health_check_failed_${health.step}`, health.detail);
  }

  console.log("[gmail-oauth] success", { userId: user.id, email: profile.email });
  return NextResponse.redirect(`${origin}/inbox?gmail_connected=1`);
}
