import Link from "next/link";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { NotificationsListClient } from "@/components/notifications/notifications-list-client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { fetchNotificationList } from "@/lib/notifications/list";
import { isCandidAdminRole } from "@/lib/staff-roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminNotificationsPageProps = {
  searchParams: Promise<{
    status?: string;
    type?: string;
    audience?: string;
    email?: string;
    failed?: string;
  }>;
};

export default async function AdminNotificationsPage({
  searchParams,
}: AdminNotificationsPageProps) {
  const filters = await searchParams;
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/notifications");
  const shellProps = await buildCrmAppShellProps(supabase, profile);
  const adminClient = createAdminClient();

  const { items, totalCount, schemaMissing } = await fetchNotificationList(adminClient, {
    status: filters.status,
    notificationType: filters.type,
    audience: filters.audience,
    email: filters.email,
    failedOnly: filters.failed === "1",
  });

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Administration"
          title="Notifications"
          description="Delivery log for customer and internal Candid OS emails."
          actions={
            isCandidAdminRole(profile.user_role) ? (
              <Link href="/admin/settings/notifications">
                <Button type="button" variant="outline">
                  Notification settings
                </Button>
              </Link>
            ) : null
          }
        />

        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading notifications…</p>}>
          <NotificationsListClient
            items={items}
            totalCount={totalCount}
            schemaMissing={schemaMissing}
            canRetry={isCandidAdminRole(profile.user_role)}
            initialFilters={filters}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}
