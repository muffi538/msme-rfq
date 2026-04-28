"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, Mail, Lock, Building2 } from "lucide-react";

type Step = "details" | "otp" | "password" | "done";

export default function SignupPage() {
  const router = useRouter();
  const [step,          setStep]          = useState<Step>("details");
  const [companyName,   setCompanyName]   = useState("");
  const [email,         setEmail]         = useState("");
  const [otp,           setOtp]           = useState(["", "", "", "", "", ""]);
  const [password,      setPassword]      = useState("");
  const [confirmPass,   setConfirmPass]   = useState("");
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [resendCooldown,setResendCooldown]= useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  /* ── Step 1: send OTP ── */
  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!companyName.trim()) { setError("Company name is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Enter a valid email."); return; }

    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        data: { company_name: companyName },
      },
    });
    setLoading(false);

    if (err) { setError(err.message); return; }
    setStep("otp");
    setResendCooldown(60);
  }

  /* ── Step 2: verify OTP ── */
  function handleOtpChange(i: number, val: string) {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[i] = val.slice(-1);
    setOtp(next);
    if (val && i < 5) otpRefs.current[i + 1]?.focus();
  }

  function handleOtpKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (digits.length === 6) {
      setOtp(digits.split(""));
      otpRefs.current[5]?.focus();
    }
    e.preventDefault();
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const token = otp.join("");
    if (token.length !== 6) { setError("Enter the 6-digit code from your email."); return; }

    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setLoading(false);

    if (err) { setError("Incorrect code. Please try again."); return; }
    setStep("password");
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setError("");
    const supabase = createClient();
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setResendCooldown(60);
  }

  /* ── Step 3: set password ── */
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPass) { setError("Passwords don't match."); return; }

    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (err) { setError(err.message); return; }
    setStep("done");
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  /* ── Step indicators ── */
  const steps = [
    { label: "Details",  icon: Building2 },
    { label: "Verify",   icon: Mail },
    { label: "Password", icon: Lock },
  ];
  const stepIndex = step === "details" ? 0 : step === "otp" ? 1 : 2;

  if (step === "done") {
    return (
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-10 pb-10 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Account created!</h2>
          <p className="text-gray-500 text-sm">Taking you to your dashboard…</p>
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mx-auto mt-4" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-bold">Create your account</CardTitle>
        <CardDescription>Start automating your RFQ workflow today</CardDescription>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mt-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`flex items-center gap-1.5 text-xs font-medium ${
                i < stepIndex ? "text-green-600" : i === stepIndex ? "text-blue-600" : "text-gray-300"
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i < stepIndex ? "bg-green-100 text-green-600" :
                  i === stepIndex ? "bg-blue-600 text-white" :
                  "bg-gray-100 text-gray-400"
                }`}>
                  {i < stepIndex ? "✓" : i + 1}
                </div>
                <span className="hidden sm:block">{s.label}</span>
              </div>
              {i < 2 && (
                <div className={`flex-1 h-0.5 mx-2 ${i < stepIndex ? "bg-green-300" : "bg-gray-100"}`} />
              )}
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* ── Step 1: Details ── */}
        {step === "details" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Company name</Label>
              <Input
                placeholder="Sharma Traders Pvt Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Work email</Label>
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send verification code →"}
            </Button>
            <p className="text-center text-sm text-gray-500">
              Already have an account?{" "}
              <Link href="/login" className="text-blue-600 font-medium hover:underline">Log in</Link>
            </p>
          </form>
        )}

        {/* ── Step 2: OTP ── */}
        {step === "otp" && (
          <form onSubmit={handleVerifyOtp} className="space-y-5">
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm text-blue-700 flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>We sent a 6-digit code to <strong>{email}</strong>. Check your inbox.</p>
            </div>

            <div className="space-y-2">
              <Label>Enter the 6-digit code</Label>
              <div className="flex gap-2 justify-between" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold border-2 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <Button type="submit" disabled={loading || otp.join("").length !== 6} className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify code →"}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => { setStep("details"); setOtp(["","","","","",""]); setError(""); }}
                className="text-gray-500 hover:text-gray-700">
                ← Change email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}

        {/* ── Step 3: Set password ── */}
        {step === "password" && (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="bg-green-50 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Email verified! Now set a password for your account.
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm password</Label>
              <Input
                type="password"
                placeholder="Re-enter password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
              />
            </div>
            {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account →"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
