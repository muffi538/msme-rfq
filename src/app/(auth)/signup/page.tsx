"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, Lock, ArrowRight } from "lucide-react";

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

export default function SignupPage() {
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

  /* ── Email + Password sign-up ── */
  async function handleEmailSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setError("");
    const supabase = createClient();

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);

    if (err) {
      // Friendlier copy for the most common error
      if (err.message.toLowerCase().includes("already registered") ||
          err.message.toLowerCase().includes("user already")) {
        setError("This email is already registered. Try logging in instead.");
      } else {
        setError(err.message);
      }
      return;
    }

    // If a session was returned (Supabase email-confirmation OFF), go straight in
    if (data.session) {
      window.location.href = "/onboarding";
      return;
    }

    // Otherwise we'd hit confirm-email — but we recommend turning that off in Supabase.
    // Until then, route them to login with a friendly message.
    window.location.href = "/login?message=Check+your+email+to+confirm+your+account%2C+then+log+in.";
  }

  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-2xl font-bold text-card-foreground">Create your account</CardTitle>
        <CardDescription>Join Procur.AI — start automating in minutes</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">

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
          <span className="text-xs text-muted-foreground">or sign up with email</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email + password form */}
        <form onSubmit={handleEmailSignup} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Work email
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
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              autoComplete="new-password"
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
              : <><span>Create account</span><ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-[#1847F5] font-medium hover:underline">Log in</Link>
        </p>

      </CardContent>
    </Card>
  );
}
