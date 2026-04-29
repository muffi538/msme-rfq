import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const origin = new URL(request.url).origin;

  if (!user) return NextResponse.redirect(`${origin}/login`);

  const params = new URLSearchParams({
    client_id:     process.env.GMAIL_CLIENT_ID!,
    redirect_uri:  `${origin}/api/auth/gmail/callback`,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    access_type: "offline",
    prompt:      "consent",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
