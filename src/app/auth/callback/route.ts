import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if this user has completed onboarding
      const { data: { user } } = await supabase.auth.getUser();
      // company_name is set during onboarding — Google OAuth never sets it,
      // so any account without it is a first-time user who needs onboarding
      const done = !!user?.user_metadata?.company_name;

      if (!done) {
        // First-time user — collect their profile info before dashboard
        return NextResponse.redirect(`${origin}/onboarding`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?message=Sign-in+link+expired+or+already+used.+Please+try+again.`
  );
}
