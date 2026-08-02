import Link from "next/link";

import SetPasswordForm from "@/components/set-password-form";
import { AuthPageLayout } from "@/components/auth-page-layout";
import { getAuthCallbackErrorMessage } from "@/lib/auth-invite-redirect";
import { createClient } from "@/lib/supabase/server";

export default async function SetPasswordPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (process.env.NODE_ENV === "development") {
    console.info("[set-password] session check", {
      hasAuthenticatedUser: Boolean(user),
    });
  }

  if (!user) {
    const message = getAuthCallbackErrorMessage("invitation_session_required");

    return (
      <AuthPageLayout
        title="Invitation required"
        description="Open your portal invitation email to set your password."
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
          <p className="text-sm text-muted-foreground">
            Already have a password?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
            >
              Sign in
            </Link>
          </p>
        </div>
      </AuthPageLayout>
    );
  }

  return <SetPasswordForm />;
}
