"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, Building2, Lock, ArrowRight, RefreshCw } from "lucide-react";

type Step = "details" | "verify";

export default function SignupPage() {
  const [step,        setStep]        = useState<Step>("details");
  const [companyName, setCompanyName] = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [loading,          setLoading]          = useState(false);
  const [resending,        setResending]        = useState(false);
  const [error,            setError]            = useState("");
  const [resendOk,         setResendOk]         = useState(false);
  const [showResendInline, setShowResendInline] = useState(false);

  /* ── Step 1: Create account ── */
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!companyName.trim())                           { setError("Company name is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))    { setError("Enter a valid email address."); return; }
    if (password.length < 8)                           { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPass)                      { setError("Passwords don't match."); return; }

    setLoading(true);
    const supabase = createClient();

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // After clicking the confirmation link, Supabase redirects here.
        // /auth/callback exchanges the code for a session and sends to /dashboard.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { company_name: companyName },
      },
    });

    setLoading(false);

    if (err) {
      if (err.message.toLowerCase().includes("already registered") ||
          err.message.toLowerCase().includes("already exists")) {
        setError("An account with this email already exists. Log in instead, or use a different email.");
      } else {
        setError(err.message);
      }
      return;
    }

    // Supabase returns identities:[] when the user already exists but email
    // is unconfirmed — it silently "succeeds" but sends a magic link, not a
    // confirmation. Detect this and offer a resend button.
    if (data.user && data.user.identities?.length === 0) {
      setError(
        "An account with this email already exists but hasn't been verified yet."
      );
      setShowResendInline(true);
      return;
    }

    setStep("verify");
  }

  /* ── Resend verification email (from step 2 "verify" screen) ── */
  async function handleResend() {
    setResending(true);
    setResendOk(false);
    const supabase = createClient();
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    setResendOk(true);
    setTimeout(() => setResendOk(false), 5000);
  }

  /* ── Resend from step 1 error state (unconfirmed existing account) ── */
  async function handleResendInline() {
    setResending(true);
    setError("");
    const supabase = createClient();
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    setShowResendInline(false);
    setStep("verify"); // go straight to the "check your inbox" screen
  }

  /* ── Step indicators ── */
  const stepIndex = step === "details" ? 0 : 1;
  const STEPS = [
    { label: "Your details", icon: Building2 },
    { label: "Verify email",  icon: Mail },
  ];

  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-bold text-card-foreground">
          Create your account
        </CardTitle>
        <CardDescription>Start automating your RFQ workflow today</CardDescription>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mt-4">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`flex items-center gap-2 text-xs font-medium ${
                i < stepIndex  ? "text-green-600" :
                i === stepIndex ? "text-[#1847F5]"  : "text-muted-foreground/40"
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  i < stepIndex  ? "bg-green-100 text-green-700" :
                  i === stepIndex ? "bg-[#1847F5] text-white shadow-[0_2px_8px_rgba(24,71,245,0.4)]" :
                  "bg-muted text-muted-foreground/40"
                }`}>
                  {i < stepIndex ? "✓" : i + 1}
                </div>
                <span className="hidden sm:block">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-3 transition-colors ${
                  i < stepIndex ? "bg-green-300" : "bg-border"
                }`} />
              )}
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-5">

        {/* ── Step 1: Details ── */}
        {step === "details" && (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="company">Company name</Label>
              <Input
                id="company"
                placeholder="Sharma Traders Pvt Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoComplete="organization"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setShowResendInline(false); setError(""); }}
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="Re-enter password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 px-4 py-3.5 rounded-xl space-y-3">
                <p className="text-red-600 text-sm">{error}</p>

                {showResendInline && (
                  <div className="flex flex-col gap-2 pt-1 border-t border-red-200">
                    <p className="text-xs text-red-500">
                      Can&apos;t find the email? We&apos;ll send a fresh one right now.
                    </p>
                    <button
                      type="button"
                      onClick={handleResendInline}
                      disabled={resending}
                      className="inline-flex items-center gap-2 self-start px-4 py-2 bg-[#1847F5] hover:bg-[#0f35d4] text-white text-xs font-semibold rounded-full transition-colors disabled:opacity-60 shadow-[0_2px_8px_rgba(24,71,245,0.35)]"
                    >
                      {resending
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                        : <><RefreshCw className="w-3 h-3" /> Resend verification email</>}
                    </button>
                  </div>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 font-semibold rounded-full bg-[#1847F5] hover:bg-[#0f35d4] text-white shadow-[0_2px_8px_rgba(24,71,245,0.35)] gap-2"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><span>Create account</span><ArrowRight className="w-4 h-4" /></>}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-[#1847F5] font-medium hover:underline">Log in</Link>
            </p>
          </form>
        )}

        {/* ── Step 2: Verify email ── */}
        {step === "verify" && (
          <div className="space-y-5">
            {/* Big icon */}
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-16 h-16 bg-[#1847F5]/8 rounded-2xl flex items-center justify-center mb-4">
                <Mail className="w-8 h-8 text-[#1847F5]" />
              </div>
              <h3 className="font-bold text-card-foreground text-lg mb-2">Check your inbox</h3>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
                We sent a verification link to{" "}
                <span className="font-semibold text-card-foreground">{email}</span>.
                <br />Click the link to verify your account and log in.
              </p>
            </div>

            {/* What to expect */}
            <div className="bg-muted/50 border border-border rounded-xl px-4 py-3.5 space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="text-[#1847F5] font-bold flex-shrink-0 mt-px">1.</span>
                <span>Open the email from <strong>Supabase / RFQ Flow</strong></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[#1847F5] font-bold flex-shrink-0 mt-px">2.</span>
                <span>Click the <strong>"Confirm your email"</strong> button</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[#1847F5] font-bold flex-shrink-0 mt-px">3.</span>
                <span>You'll be taken straight to your dashboard</span>
              </div>
            </div>

            {/* Resend */}
            <div className="text-center">
              {resendOk ? (
                <p className="text-green-600 text-sm font-medium">Verification email resent ✓</p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#1847F5] transition-colors disabled:opacity-50"
                >
                  {resending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Didn&apos;t receive it? Resend email
                </button>
              )}
            </div>

            {/* Back link */}
            <div className="text-center">
              <button
                onClick={() => { setStep("details"); setError(""); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Wrong email? Go back
              </button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
