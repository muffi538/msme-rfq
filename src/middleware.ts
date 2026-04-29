import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/inbox", "/rfqs", "/suppliers", "/settings", "/admin"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // ── Logged-out users ──────────────────────────────────────────────────────
  const isProtected = PROTECTED.some((p) => path.startsWith(p));
  if (!user && (isProtected || path === "/onboarding")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // ── Logged-in users ───────────────────────────────────────────────────────
  if (user && !path.startsWith("/auth/")) {
    // company_name is set by the onboarding page — reliable indicator
    // because Google OAuth never sets it, so new users always hit onboarding
    const onboarded = !!user.user_metadata?.company_name;

    // Block dashboard/inbox/etc until onboarding is done
    if (!onboarded && isProtected) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }

    // Already onboarded — skip the onboarding page
    if (onboarded && path === "/onboarding") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Already logged in — skip auth/marketing pages
    const authPages = ["/", "/login", "/signup"];
    if (authPages.includes(path)) {
      return NextResponse.redirect(new URL(
        onboarded ? "/dashboard" : "/onboarding",
        request.url
      ));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
