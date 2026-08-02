import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildLoginUrl } from "@/lib/auth-redirect";
import {
  isCandidAdminRole,
  isLimitedStaffRole,
} from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffWorkspacePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/staff"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.account_status !== "approved") {
    redirect("/login");
  }

  if (isCandidAdminRole(profile.user_role)) {
    redirect("/admin");
  }

  if (!isLimitedStaffRole(profile.user_role)) {
    redirect("/dashboard");
  }

  return (
    <AppShell
      userRole="staff"
      userName={profile.full_name || "Candid team member"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Staff workspace"
          title="Welcome back"
          description="Your dedicated Candid OS workspace is being prepared."
        />

        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">
              Workspace coming soon
            </CardTitle>
            <CardDescription>
              Your staff workspace is currently being prepared.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              You&apos;re signed in with the{" "}
              <span className="font-medium text-foreground">
                {profile.user_role.replace("_", " ")}
              </span>{" "}
              role. We&apos;ll enable your tools here as Candid OS staff modules
              roll out.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
