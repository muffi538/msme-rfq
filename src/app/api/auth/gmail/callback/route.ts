import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/inbox?gmail_error=access_denied`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  };

  if (!tokens.refresh_token || !tokens.access_token) {
    console.error("Gmail token exchange failed:", tokens.error);
    return NextResponse.redirect(`${origin}/inbox?gmail_error=token_failed`);
  }

  // Get the Gmail address for this account
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json() as { email?: string };
  const gmailEmail = profile.email ?? "";

  // Save per-user Gmail credentials to user_settings
  await supabase.from("user_settings").upsert(
    [
      { user_id: user.id, key: "gmail_refresh_token", value: tokens.refresh_token },
      { user_id: user.id, key: "gmail_email",         value: gmailEmail },
    ],
    { onConflict: "user_id,key" }
  );

  return NextResponse.redirect(`${origin}/inbox?gmail_connected=1`);
}
