import { redirect } from "next/navigation";

import { AdminSettingsPanel } from "@/components/admin-settings-panel";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { getEmailConfigStatus } from "@/lib/app-settings";
import { loadAppSettings } from "@/lib/app-settings-server";
import { buildLoginUrl } from "@/lib/auth-redirect";
import {
  isCandidAdminRole,
  isSuperAdminRole,
  resolveAdminAccessDeniedPath,
} from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/admin/settings"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !isCandidAdminRole(profile.user_role) ||
    profile.account_status !== "approved"
  ) {
    redirect(resolveAdminAccessDeniedPath(profile?.user_role));
  }

  const { settings, error: settingsLoadError } = await loadAppSettings(supabase);
  const emailConfig = getEmailConfigStatus(settings);
  const canEdit = isSuperAdminRole(profile.user_role);

  return (
    <AppShell
      userRole="admin"
      showStaffNav={isSuperAdminRole(profile.user_role)}
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title="Settings"
          description="Configure Candid OS defaults, branding and platform behaviour."
        />

        <AdminSettingsPanel
          settings={settings}
          canEdit={canEdit}
          userRole={profile.user_role}
          emailConfig={emailConfig}
          settingsLoadError={settingsLoadError}
        />
      </div>
    </AppShell>
  );
}
