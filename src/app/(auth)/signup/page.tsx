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
import { Loader2 } from "lucide-react";

const schema = z.object({
  companyName: z.string().min(2, "Company name must be at least 2 characters"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setServerError("");
    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { company_name: data.companyName },
      },
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✓</span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm">
            We sent a confirmation link to your email. Click it to activate your account.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-2xl font-bold">Create your account</CardTitle>
        <CardDescription>Start automating your RFQ workflow today</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Company Name */}
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company name</Label>
            <Input
              id="companyName"
              placeholder="Sharma Traders Pvt Ltd"
              {...register("companyName")}
              className={errors.companyName ? "border-red-400" : ""}
            />
            {errors.companyName && (
              <p className="text-red-500 text-xs">{errors.companyName.message}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min. 8 characters"
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
              {serverError}
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-semibold"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
          </Button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="text-blue-600 font-medium hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
