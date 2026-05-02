"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ArrowRight, Building2, User, Lock, CheckCircle2, XCircle } from "lucide-react";

/* ── Password strength rules ── */
const RULES = [
  { label: "At least 8 characters",          test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter (A–Z)",      test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter (a–z)",      test: (p: string) => /[a-z]/.test(p) },
  { label: "One special character (@, #, !…)", test: (p: string) => /[@#!$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(p) },
];

function PasswordChecker({ password }: { password: string }) {
  if (!password) return null;
  return (
    <ul className="space-y-1 mt-1">
      {RULES.map(({ label, test }) => {
        const ok = test(password);
        return (
          <li key={label} className={`flex items-center gap-1.5 text-xs ${ok ? "text-green-600" : "text-muted-foreground"}`}>
            {ok
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
              : <XCircle      className="w-3.5 h-3.5 shrink-0 text-red-400" />}
            {label}
          </li>
        );
      })}
    </ul>
  );
}

export default function OnboardingPage() {
  const [fullName,        setFullName]        = useState("");
  const [companyName,     setCompanyName]     = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPass,     setConfirmPass]     = useState("");
  const [email,           setEmail]           = useState("");
  const [hasPassword,     setHasPassword]     = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [booting,         setBooting]         = useState(true);
  const [error,           setError]           = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) { window.location.href = "/login"; return; }

      if (user.user_metadata?.company_name) {
        window.location.href = "/dashboard";
        return;
      }

      setEmail(user.email ?? "");
      setFullName(
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        ""
      );

      // If they signed up via email+password, the 'email' identity is present
      // and they already have a password — skip the password section entirely.
      const providers = user.identities?.map((i) => i.provider) ?? [];
      setHasPassword(providers.includes("email"));

      setBooting(false);
    })();
  }, []);

  function isPasswordStrong(p: string) {
    return RULES.every(({ test }) => test(p));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!fullName.trim())    { setError("Please enter your full name."); return; }
    if (!companyName.trim()) { setError("Please enter your company name."); return; }

    // Password section only enforced for users who DON'T already have one
    // (i.e. Google OAuth users — email/password signups already set theirs).
    if (!hasPassword) {
      if (!password)           { setError("Please set a password for your account."); return; }
      if (!isPasswordStrong(password)) {
        setError("Password doesn't meet the requirements. Please check the rules below.");
        return;
      }
      if (password !== confirmPass) { setError("Passwords don't match."); return; }
    }

    setLoading(true);
    const supabase = createClient();

    const updatePayload: Parameters<typeof supabase.auth.updateUser>[0] = {
      data: {
        full_name:           fullName.trim(),
        company_name:        companyName.trim(),
        onboarding_complete: true,
      },
    };
    if (!hasPassword && password) updatePayload.password = password;

    const { error: metaErr } = await supabase.auth.updateUser(updatePayload);

    if (metaErr) {
      setError(metaErr.message);
      setLoading(false);
      return;
    }

    await supabase.auth.refreshSession();
    window.location.href = "/dashboard";
  }

  if (booting) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allRulesMet = isPasswordStrong(password);
  const passwordsMatch = password && confirmPass && password === confirmPass;

  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="pb-4">
        <div className="w-12 h-12 bg-[#1847F5]/10 rounded-2xl flex items-center justify-center mb-3">
          <Building2 className="w-6 h-6 text-[#1847F5]" />
        </div>
        <CardTitle className="text-2xl font-bold text-card-foreground">
          Set up your profile
        </CardTitle>
        <CardDescription>
          Just a few details and you&apos;re in. Takes 30 seconds.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Email — read only */}
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} disabled className="bg-muted text-muted-foreground" />
          </div>

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Full name
              </span>
            </Label>
            <Input
              id="name"
              placeholder="Ramesh Sharma"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>

          {/* Company name */}
          <div className="space-y-1.5">
            <Label htmlFor="company">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Company name
              </span>
            </Label>
            <Input
              id="company"
              placeholder="Sharma Traders Pvt Ltd"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              autoComplete="organization"
            />
          </div>

          {/* Password section — skipped for users who already set a password at signup */}
          {!hasPassword && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-medium text-[#1847F5]">Set your password</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <p className="text-xs text-muted-foreground text-center">
              You&apos;ll use this to log in next time with your email.
            </p>

            {/* Password field */}
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
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={password
                  ? allRulesMet
                    ? "border-green-400 focus-visible:ring-green-300"
                    : "border-red-300 focus-visible:ring-red-200"
                  : ""}
              />
              <PasswordChecker password={password} />
            </div>

            {/* Confirm password — only show once they start typing */}
            {password && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> Confirm password
                  </span>
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="Re-enter password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  autoComplete="new-password"
                  className={confirmPass
                    ? passwordsMatch
                      ? "border-green-400 focus-visible:ring-green-300"
                      : "border-red-300 focus-visible:ring-red-200"
                    : ""}
                />
                {confirmPass && !passwordsMatch && (
                  <p className="text-xs text-red-500">Passwords don&apos;t match.</p>
                )}
                {passwordsMatch && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Passwords match
                  </p>
                )}
              </div>
            )}
          </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2.5 rounded-xl">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-full bg-[#1847F5] text-white text-sm font-semibold shadow-[0_2px_12px_rgba(24,71,245,0.4)] hover:bg-[#0f35d4] hover:shadow-[0_4px_20px_rgba(24,71,245,0.5)] transition-all disabled:opacity-60"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><span>Go to dashboard</span><ArrowRight className="w-4 h-4" /></>}
          </button>

        </form>
      </CardContent>
    </Card>
  );
}
