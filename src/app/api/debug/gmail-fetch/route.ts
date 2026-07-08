import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Temporary diagnostic endpoint — confirms which Gmail account the stored
// refresh token actually authenticates as, and what Gmail itself reports
// for unread inbox count, bypassing our own query logic entirely.
// Remove once "Fetch New Emails" is confirmed pulling real messages.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: tokenRows, error: tokenLookupError } = await supabase
    .from("user_settings")
    .select("value, created_at")
    .eq("user_id", user.id)
    .eq("key", "gmail_refresh_token")
    .order("created_at", { ascending: false });

  const refreshToken = tokenRows?.[0]?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token stored", tokenLookupError: tokenLookupError?.message ?? null, rowCount: tokenRows?.length ?? 0 });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string; scope?: string };

  if (!tokenData.access_token) {
    return NextResponse.json({
      step: "access_token_refresh",
      ok: false,
      status: tokenRes.status,
      error: tokenData.error,
      rowCount: tokenRows?.length ?? 0,
      tokenRowCreatedAt: tokenRows?.map((r) => r.created_at),
    });
  }

  const authHeader = { Authorization: `Bearer ${tokenData.access_token}` };

  const [profileRes, inboxLabelRes, searchRes] = await Promise.all([
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: authHeader }),
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX", { headers: authHeader }),
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent("is:unread in:inbox")}&maxResults=20`, { headers: authHeader }),
  ]);

  const [profile, inboxLabel, search] = await Promise.all([
    profileRes.json(),
    inboxLabelRes.json(),
    searchRes.json(),
  ]);

  return NextResponse.json({
    scopeGranted: tokenData.scope,
    rowCount: tokenRows?.length ?? 0,
    tokenRowCreatedAt: tokenRows?.map((r) => r.created_at),
    profile: { status: profileRes.status, body: profile },       // .emailAddress = actual authenticated Gmail account
    inboxLabel: { status: inboxLabelRes.status, body: inboxLabel }, // .messagesUnread = ground-truth unread count from Gmail itself
    searchQuery: { status: searchRes.status, body: search },     // what our exact query returns
  });
}
