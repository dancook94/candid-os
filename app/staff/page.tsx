import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildStaffAppShellProps } from "@/lib/admin-shell-props";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { getStaffPortalRedirect } from "@/lib/portal-access";
import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffWorkspacePage() {
  const supabase = await createClient();
  const isDevelopment = process.env.NODE_ENV === "development";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/staff"));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status, avatar_storage_path")
    .eq("id", user.id)
    .single();

  const access = getStaffPortalRedirect(profile, profileError);

  if (access === "login") {
    if (isDevelopment && profileError) {
      console.error("[staff] profile load failed:", profileError.message);
    }

    redirect(buildLoginUrl("/staff"));
  }

  if (access !== "allow") {
    redirect(access);
  }

  const shellProps = await buildStaffAppShellProps(supabase, profile!);
  const avatarPreviewUrl = await loadStaffAvatarSignedUrl(supabase, profile!);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            eyebrow="Staff workspace"
            title="Welcome back"
            description="Your dedicated Candid OS workspace is being prepared."
          />

          <StaffAvatarDisplay
            fullName={profile!.full_name || "Candid team member"}
            avatarUrl={avatarPreviewUrl}
            size="lg"
          />
        </div>

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
                {profile!.user_role.replace("_", " ")}
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
