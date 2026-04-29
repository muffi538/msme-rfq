"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ArrowRight, Building2, User, Lock } from "lucide-react";

export default function OnboardingPage() {
  const [fullName,    setFullName]    = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password,    setPassword]    = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [email,       setEmail]       = useState("");
  const [isGoogle,    setIsGoogle]    = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [booting,     setBooting]     = useState(true);
  const [error,       setError]       = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) { window.location.href = "/login"; return; }

      // Already onboarded (has company_name) — go to dashboard
      if (user.user_metadata?.company_name) {
        window.location.href = "/dashboard";
        return;
      }

      setEmail(user.email ?? "");
      // Pre-fill name from Google profile
      setFullName(
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        ""
      );

      const providers = user.identities?.map((i) => i.provider) ?? [];
      setIsGoogle(providers.includes("google"));

      setBooting(false);
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!fullName.trim())    { setError("Please enter your full name."); return; }
    if (!companyName.trim()) { setError("Please enter your company name."); return; }

    if (password) {
      if (password.length < 8)        { setError("Password must be at least 8 characters."); return; }
      if (password !== confirmPass)    { setError("Passwords don't match."); return; }
    }

    setLoading(true);
    const supabase = createClient();

    const updatePayload: Parameters<typeof supabase.auth.updateUser>[0] = {
      data: {
        full_name:    fullName.trim(),
        company_name: companyName.trim(),
        onboarding_complete: true,
      },
    };
    if (password) updatePayload.password = password;

    const { error: metaErr } = await supabase.auth.updateUser(updatePayload);

    if (metaErr) {
      setError(metaErr.message);
      setLoading(false);
      return;
    }

    // Refresh the session so the new JWT carries company_name
    // — middleware reads the JWT, so without this it may still see old data
    await supabase.auth.refreshSession();

    // Hard redirect (not SPA navigation) so browser sends fresh cookies
    window.location.href = "/dashboard";
  }

  if (booting) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} disabled className="bg-muted text-muted-foreground" />
          </div>

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

          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">
                {isGoogle ? "Set a password (optional)" : "Set your password"}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {isGoogle && (
              <p className="text-xs text-muted-foreground text-center">
                You&apos;re signed in with Google — no password needed.
                Add one only if you&apos;d like to also log in with email.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  {isGoogle ? "Password (optional)" : "Password"}
                </span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder={isGoogle ? "Leave blank to skip" : "Min. 8 characters"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {password && (
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
            )}
          </div>

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
