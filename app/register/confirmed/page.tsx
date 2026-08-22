import { redirect } from "next/navigation";

import { AuthPageLayout } from "@/components/auth-page-layout";
import { ReturnToLoginButton } from "@/components/return-to-login-button";
import { getDashboardRoleRedirect } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RegisterConfirmedPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status, user_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    const roleRedirect = getDashboardRoleRedirect(profile);

    if (roleRedirect) {
      redirect(roleRedirect);
    }

    if (profile.user_role !== "customer") {
      redirect("/login");
    }

    if (profile.account_status === "approved") {
      redirect("/dashboard");
    }

    if (profile.account_status === "disabled") {
      redirect("/login");
    }
  }

  const email = user.email?.trim();

  return (
    <AuthPageLayout
      title="Registration received"
      description="Thank you for confirming your email address with Candid Creative."
    >
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Email confirmed
          </h2>
          <p className="text-sm text-muted-foreground">
            Your registration has been received and is awaiting approval from
            Candid Creative.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>
            We&apos;ll email you as soon as your account has been approved.
          </p>
          {email ? (
            <p className="mt-3">
              <span className="font-medium">Registered email:</span>{" "}
              {email}
            </p>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">
          Portal access is not available yet. You can sign out and return once
          your approval email arrives.
        </p>

        <ReturnToLoginButton />
      </div>
    </AuthPageLayout>
  );
}
