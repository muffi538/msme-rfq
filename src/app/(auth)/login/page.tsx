"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Loader2, ArrowRight, AlertCircle,
  Mail, Lock, LogIn,
  UserCircle2, Inbox, Zap,
} from "lucide-react";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

const STEPS = [
  {
    icon: LogIn,
    title: "Sign in",
    desc: "Use Google for instant access, or enter your email and password.",
  },
  {
    icon: UserCircle2,
    title: "Your profile",
    desc: "Company name and contact details — takes 30 seconds.",
  },
  {
    icon: Inbox,
    title: "Connect Gmail",
    desc: "Link your inbox so RFQs are read automatically.",
  },
  {
    icon: Zap,
    title: "Go live",
    desc: "Incoming RFQs are parsed and replied to on your behalf.",
  },
];

function LoginForm() {
  const searchParams = useSearchParams();
  const urlMessage   = searchParams.get("message");

  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");

  /* ── Google OAuth ── */
  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (err) { setError(err.message); setGoogleLoading(false); }
  }

  /* ── Email + Password ── */
  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim())    { setError("Please enter your email."); return; }
    if (!password.trim()) { setError("Please enter your password."); return; }

    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (err) {
      // Make Supabase's generic message friendlier
      if (err.message.toLowerCase().includes("invalid login")) {
        setError("Incorrect email or password. Try again, or sign in with Google.");
      } else {
        setError(err.message);
      }
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <div className="w-full flex items-start gap-10 max-w-3xl">

      {/* ── Steps panel (desktop only) ── */}
      <div className="hidden lg:flex flex-col gap-6 w-64 shrink-0 pt-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#1847F5] mb-1">How it works</p>
          <h2 className="text-xl font-bold text-[#1a1209] leading-snug">
            From sign-in to<br />live in minutes
          </h2>
        </div>

        <div className="flex flex-col gap-5">
          {STEPS.map(({ icon: Icon, title, desc }, i) => (
            <div key={i} className="flex items-start gap-3">
              {/* Step number + connector */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-[#1847F5]/10 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#1847F5]" />
                </div>
                {i < STEPS.length - 1 && (
                  <div className="w-px flex-1 bg-[#1847F5]/20 mt-1 mb-[-8px] min-h-[20px]" />
                )}
              </div>
              <div className="pb-4">
                <p className="text-sm font-semibold text-[#1a1209]">{title}</p>
                <p className="text-xs text-[#7a6a52] leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Login card ── */}
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-card-foreground">Welcome back</CardTitle>
          <CardDescription>Sign in to your RFQ Flow account</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">

          {urlMessage && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {urlMessage}
            </div>
          )}

          {/* Google — primary CTA */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-full bg-[#1847F5] text-white text-sm font-semibold shadow-[0_2px_12px_rgba(24,71,245,0.4)] hover:bg-[#0f35d4] hover:shadow-[0_4px_20px_rgba(24,71,245,0.5)] transition-all disabled:opacity-60"
          >
            {googleLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><GoogleIcon /><span>Continue with Google</span><ArrowRight className="w-4 h-4" /></>}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or sign in with email</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Email + password form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> Email address
                </span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Password
                </span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium text-card-foreground hover:bg-muted/50 transition-all disabled:opacity-60 shadow-sm"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><LogIn className="w-4 h-4" /><span>Sign in</span></>}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link href="/signup" className="text-[#1847F5] font-medium hover:underline">
              Sign up free
            </Link>
          </p>

        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardContent className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    }>
      <LoginForm />
    </Suspense>
  );
}
