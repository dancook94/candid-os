"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { AuthPageLayout } from "@/components/auth-page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildInvitePasswordSetupRedirect } from "@/lib/auth-invite-redirect";
import { createClient } from "@/lib/supabase/client";

const SUCCESS_MESSAGE =
  "If an account exists for that email address, a password setup link has been sent.";

function isValidEmailFormat(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordForm() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccessMessage("");

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Email address is required.");
      return;
    }

    if (!isValidEmailFormat(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    const redirectTo = buildInvitePasswordSetupRedirect(window.location.origin);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      { redirectTo }
    );

    setIsSubmitting(false);

    if (resetError && process.env.NODE_ENV === "development") {
      console.error("[forgot-password] resetPasswordForEmail failed", resetError);
    }

    setSuccessMessage(SUCCESS_MESSAGE);
    setEmail("");
  }

  return (
    <AuthPageLayout
      title="Forgot password?"
      description="Enter your email address and we’ll send you a password setup link."
      footer={
        <>
          Remember your password?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
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
            disabled={isSubmitting}
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {successMessage}
          </div>
        ) : null}

        <Button type="submit" disabled={isSubmitting} className="h-10 w-full">
          {isSubmitting ? "Sending reset link..." : "Send reset link"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthPageLayout>
  );
}
