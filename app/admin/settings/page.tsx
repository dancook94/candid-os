import { AdminSettingsPanel } from "@/components/admin-settings-panel";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { getEmailConfigStatus } from "@/lib/app-settings";
import { loadAppSettings } from "@/lib/app-settings-server";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { isSuperAdminRole } from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/settings");

  const { settings, error: settingsLoadError } = await loadAppSettings(supabase);
  const emailConfig = getEmailConfigStatus(settings);
  const canEdit = isSuperAdminRole(profile.user_role);
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
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
