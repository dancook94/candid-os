"use client";

import Link from "next/link";

import { AuthPageLayout } from "@/components/auth-page-layout";
import { buttonVariants } from "@/components/ui/button";
import { PUBLIC_REGISTRATION_UNAVAILABLE_MESSAGE } from "@/lib/auth/public-registration";
import { cn } from "@/lib/utils";

export function RegisterUnavailable() {
  return (
    <AuthPageLayout
      title="Registration unavailable"
      description="Please sign in if you already have an account."
      footer={
        <>
          Already registered?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
          >
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {PUBLIC_REGISTRATION_UNAVAILABLE_MESSAGE}
        </p>
        <Link
          href="/login"
          className={cn(buttonVariants(), "h-10 w-full")}
        >
          Back to sign in
        </Link>
      </div>
    </AuthPageLayout>
  );
}
