"use client";

import { useState, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, ArrowRight, AlertCircle } from "lucide-react";

const schema = z.object({
  email:    z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlMessage = searchParams.get("message");

  const [serverError,   setServerError]   = useState("");
  const [showReset,     setShowReset]     = useState(false);
  const [resetEmail,    setResetEmail]    = useState("");
  const [resetSent,     setResetSent]     = useState(false);
  const [resetLoading,  setResetLoading]  = useState(false);
  const [resetError,    setResetError]    = useState("");

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setServerError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email:    data.email,
      password: data.password,
    });
    if (error) {
      setServerError("Invalid email or password. Please try again.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleForgotPassword() {
    if (!resetEmail.includes("@")) { setResetError("Enter a valid email address."); return; }
    setResetLoading(true);
    setResetError("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setResetLoading(false);
    if (error) setResetError(error.message);
    else setResetSent(true);
  }

  /* ── Forgot password panel ── */
  if (showReset) {
    return (
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-card-foreground">Reset password</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send a reset link.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {resetSent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center">
                <CheckCircle className="w-7 h-7 text-green-500" />
              </div>
              <p className="font-semibold text-card-foreground">Check your inbox!</p>
              <p className="text-sm text-muted-foreground">
                We sent a reset link to <strong className="text-card-foreground">{resetEmail}</strong>.
                Click the link in that email to set a new password.
              </p>
              <Button variant="outline" className="mt-2 rounded-full" onClick={() => { setShowReset(false); setResetSent(false); }}>
                Back to login
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Email address</Label>
                <Input type="email" placeholder="you@company.com" value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)} autoComplete="email" />
              </div>
              {resetError && <p className="text-red-500 text-sm">{resetError}</p>}
              <Button onClick={handleForgotPassword} disabled={resetLoading}
                className="w-full h-11 font-semibold rounded-full bg-[#1847F5] hover:bg-[#0f35d4] text-white shadow-[0_2px_8px_rgba(24,71,245,0.35)]">
                {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
              </Button>
              <button onClick={() => setShowReset(false)}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors">
                ← Back to login
              </button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  /* ── Normal login ── */
  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-2xl font-bold text-card-foreground">Welcome back</CardTitle>
        <CardDescription>Log in to your RFQ Flow account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

          {/* Auth callback error from URL */}
          {urlMessage && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {urlMessage}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@company.com" autoComplete="email"
              {...register("email")} className={errors.email ? "border-red-400" : ""} />
            {errors.email && <p className="text-red-500 text-xs">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button type="button"
                onClick={() => { setShowReset(true); setResetError(""); setResetSent(false); }}
                className="text-xs text-[#1847F5] hover:underline">
                Forgot password?
              </button>
            </div>
            <Input id="password" type="password" placeholder="Your password" autoComplete="current-password"
              {...register("password")} className={errors.password ? "border-red-400" : ""} />
            {errors.password && <p className="text-red-500 text-xs">{errors.password.message}</p>}
          </div>

          {serverError && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2.5 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {serverError}{" "}
                <button type="button"
                  onClick={() => { setShowReset(true); setResetError(""); setResetSent(false); }}
                  className="underline font-medium">
                  Reset it here.
                </button>
              </span>
            </div>
          )}

          <Button type="submit" disabled={isSubmitting}
            className="w-full h-11 font-semibold rounded-full bg-[#1847F5] hover:bg-[#0f35d4] text-white shadow-[0_2px_8px_rgba(24,71,245,0.35)] gap-2">
            {isSubmitting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><span>Log in</span><ArrowRight className="w-4 h-4" /></>}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-[#1847F5] font-medium hover:underline">Sign up free</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

// Suspense wrapper required because useSearchParams needs it in Next.js App Router
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
