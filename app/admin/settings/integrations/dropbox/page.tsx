import Link from "next/link";

import { AdminDropboxIntegrationPanel } from "@/components/admin-dropbox-integration-panel";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { getDropboxConnectionStatus } from "@/lib/dropbox/connection-status";
import {
  DROPBOX_OAUTH_PENDING_COOKIE,
  parsePendingOAuthCookieValue,
} from "@/lib/dropbox/oauth";
import { isSuperAdminRole } from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type DropboxIntegrationPageProps = {
  searchParams: Promise<{
    error?: string;
    setup?: string;
  }>;
};

export default async function DropboxIntegrationPage({
  searchParams,
}: DropboxIntegrationPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    "/admin/settings/integrations/dropbox"
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const canManage = isSuperAdminRole(profile.user_role);

  const cookieStore = await cookies();
  const pendingValue = cookieStore.get(DROPBOX_OAUTH_PENDING_COOKIE)?.value;
  const pendingSetup = parsePendingOAuthCookieValue(pendingValue);

  if (pendingSetup) {
    cookieStore.delete(DROPBOX_OAUTH_PENDING_COOKIE);
  }

  const connection = await getDropboxConnectionStatus();

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title="Dropbox integration"
          description="Connect Candid OS to Dropbox for customer artwork uploads."
          actions={
            <Link href="/admin/settings">
              <Button variant="outline">Back to settings</Button>
            </Link>
          }
        />

        <AdminDropboxIntegrationPanel
          canManage={canManage}
          connection={connection}
          pendingSetup={pendingSetup}
          initialError={params.error ?? null}
          initialSetupPending={params.setup === "pending" && !pendingSetup}
        />
      </div>
    </AppShell>
  );
}
