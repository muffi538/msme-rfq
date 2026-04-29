"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";

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

type View = "form" | "sent";

function LoginForm() {
  const searchParams = useSearchParams();
  const urlMessage = searchParams.get("message");

  const [view,          setView]          = useState<View>("form");
  const [email,         setEmail]         = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [magicLoading,  setMagicLoading]  = useState(false);
  const [error,         setError]         = useState("");

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

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setMagicLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    setMagicLoading(false);
    if (err) { setError(err.message); return; }
    setView("sent");
  }

  if (view === "sent") {
    return (
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-xl font-bold text-card-foreground">Check your inbox</h2>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              We sent a sign-in link to{" "}
              <span className="font-semibold text-card-foreground">{email}</span>.
              <br /><br />
              Click it to log in instantly.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 text-left w-full">
              <strong>Can&apos;t find it?</strong> Check your spam folder. The link expires in 1 hour.
            </div>
            <button
              onClick={() => { setView("form"); setError(""); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Try a different email
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-2xl font-bold text-card-foreground">Welcome back</CardTitle>
        <CardDescription>Log in to your RFQ Flow account</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">

        {urlMessage && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {urlMessage}
          </div>
        )}

        {/* Google — primary */}
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
          <span className="text-xs text-muted-foreground">or use email</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Magic link */}
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              autoComplete="email"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={magicLoading}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium text-card-foreground hover:bg-muted/50 transition-all disabled:opacity-60 shadow-sm"
          >
            {magicLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Mail className="w-4 h-4" /><span>Email me a sign-in link</span></>}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="text-[#1847F5] font-medium hover:underline">Sign up free</Link>
        </p>

      </CardContent>
    </Card>
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
