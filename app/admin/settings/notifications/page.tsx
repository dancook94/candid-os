import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { NotificationSettingsPanel } from "@/components/notifications/notification-settings-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getEmailConfigStatus } from "@/lib/app-settings";
import { loadAppSettings } from "@/lib/app-settings-server";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { getResendConfigStatus } from "@/lib/notifications/config";
import { getDefaultNotificationSettings } from "@/lib/notifications/settings";
import { loadNotificationSettings } from "@/lib/notifications/settings-store";
import { isCandidAdminRole } from "@/lib/staff-roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminNotificationSettingsPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    "/admin/settings/notifications"
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const adminClient = createAdminClient();
  const { settings: appSettings } = await loadAppSettings(supabase);

  let notificationSettings = getDefaultNotificationSettings();

  try {
    notificationSettings = await loadNotificationSettings(adminClient);
  } catch {
    notificationSettings = getDefaultNotificationSettings();
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          eyebrow="Administration"
          title="Notification settings"
          description="Configure customer and internal email notifications, recipient groups and test delivery."
          actions={
            <Link href="/admin/settings">
              <Button type="button" variant="outline">
                Back to settings
              </Button>
            </Link>
          }
        />

        <NotificationSettingsPanel
          initialSettings={notificationSettings}
          canEdit={isCandidAdminRole(profile.user_role)}
          resendConfig={getResendConfigStatus()}
          emailConfig={getEmailConfigStatus(appSettings)}
        />
      </div>
    </AppShell>
  );
}
