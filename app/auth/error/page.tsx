import Link from "next/link";
import { Suspense } from "react";

import { AuthPageLayout } from "@/components/auth-page-layout";
import { Button } from "@/components/ui/button";
import {
  getAuthCallbackErrorMessage,
  type AuthCallbackErrorFlow,
} from "@/lib/auth-invite-redirect";

type AuthErrorPageProps = {
  searchParams: Promise<{
    code?: string;
    flow?: string;
  }>;
};

function parseAuthErrorFlow(value: string | undefined): AuthCallbackErrorFlow {
  switch (value) {
    case "registration":
    case "recovery":
    case "invite":
    case "email_change":
      return value;
    default:
      return "general";
  }
}

function AuthErrorContent({
  code,
  flow,
}: {
  code?: string;
  flow: AuthCallbackErrorFlow;
}) {
  const message =
    getAuthCallbackErrorMessage(code, flow) ??
    "We could not complete sign-in from this link. Try again from the latest email, or use the sign-in page.";

  const isRegistration = flow === "registration";
  const isRecovery = flow === "recovery";

  return (
    <AuthPageLayout
      title="We couldn't verify that link"
      description="Something went wrong while completing your sign-in request."
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {message}
        </div>

        <div className="flex flex-col gap-3">
          {isRegistration ? (
            <Link href="/register">
              <Button type="button" className="h-10 w-full">
                Register again
              </Button>
            </Link>
          ) : null}

          {isRecovery ? (
            <Link href="/forgot-password">
              <Button type="button" className="h-10 w-full">
                Request a new reset link
              </Button>
            </Link>
          ) : null}

          <Link href="/login">
            <Button type="button" variant="outline" className="h-10 w-full">
              Return to login
            </Button>
          </Link>

          {!isRegistration ? (
            <Link
              href="/register"
              className="text-center text-sm text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-foreground hover:decoration-foreground"
            >
              Need a Candid OS account? Register
            </Link>
          ) : null}
        </div>
      </div>
    </AuthPageLayout>
  );
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = await searchParams;
  const flow = parseAuthErrorFlow(params.flow);

  return (
    <Suspense fallback={<p className="public-auth-page text-sm text-muted-foreground">Loading…</p>}>
      <AuthErrorContent code={params.code} flow={flow} />
    </Suspense>
  );
}
