"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthPageLayout } from "@/components/auth-page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePostLoginPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setIsSubmitting(true);

    const {
      data: { user },
      error: signInError,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !user) {
      setIsSubmitting(false);
      setError("Incorrect email address or password.");
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("account_status, user_role")
      .eq("id", user.id)
      .single();

    setIsSubmitting(false);

    if (profileError) {
      setError(profileError.message);
      return;
    }

    if (profile.account_status === "disabled") {
      await supabase.auth.signOut();
      setError(
        "Your account has been deactivated. Contact Candid Creative for assistance."
      );
      return;
    }

    router.push(resolvePostLoginPath(profile, next));
    router.refresh();
  }

  return (
    <AuthPageLayout
      title="Welcome to Candid OS"
      description="Sign in to access your Candid portal."
      footer={
        <>
          Need an account?{" "}
          <Link
            href="/register"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
          >
            Register
          </Link>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Sign in
          </h2>
          <p className="text-sm text-muted-foreground">
            Enter your account details to continue.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-foreground hover:decoration-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Button type="submit" disabled={isSubmitting} className="h-10 w-full">
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthPageLayout>
  );
}
