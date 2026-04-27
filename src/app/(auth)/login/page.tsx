"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle } from "lucide-react";

const schema = z.object({
  email:    z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError]   = useState("");
  const [showReset, setShowReset]       = useState(false);
  const [resetEmail, setResetEmail]     = useState("");
  const [resetSent, setResetSent]       = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError]     = useState("");

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
    if (!resetEmail || !resetEmail.includes("@")) {
      setResetError("Enter a valid email address.");
      return;
    }
    setResetLoading(true);
    setResetError("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    if (error) {
      setResetError(error.message);
    } else {
      setResetSent(true);
    }
  }

  /* ── Forgot-password panel ── */
  if (showReset) {
    return (
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold">Reset password</CardTitle>
          <CardDescription>
            Enter your email and we'll send a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {resetSent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-gray-900">Check your inbox!</p>
              <p className="text-sm text-gray-500">
                We sent a reset link to <strong>{resetEmail}</strong>.<br />
                Click the link in that email to set a new password.
              </p>
              <Button variant="outline" className="mt-2" onClick={() => { setShowReset(false); setResetSent(false); }}>
                Back to login
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Email address</Label>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
              </div>
              {resetError && (
                <p className="text-red-500 text-sm">{resetError}</p>
              )}
              <Button
                onClick={handleForgotPassword}
                disabled={resetLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold"
              >
                {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
              </Button>
              <button
                onClick={() => setShowReset(false)}
                className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
              >
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
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
        <CardDescription>Log in to your RFQ Flow account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              {...register("email")}
              className={errors.email ? "border-red-400" : ""}
            />
            {errors.email && (
              <p className="text-red-500 text-xs">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetError(""); setResetSent(false); }}
                className="text-xs text-blue-600 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Your password"
              {...register("password")}
              className={errors.password ? "border-red-400" : ""}
            />
            {errors.password && (
              <p className="text-red-500 text-xs">{errors.password.message}</p>
            )}
          </div>

          {/* Server error */}
          {serverError && (
            <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">
              {serverError}{" "}
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetError(""); setResetSent(false); }}
                className="underline font-medium"
              >
                Reset it here.
              </button>
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log in"}
          </Button>

          <p className="text-center text-sm text-gray-500">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-blue-600 font-medium hover:underline">
              Sign up free
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
