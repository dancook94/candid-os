import Link from "next/link";

import { PrintfactoryMatchingClient } from "@/components/production/printfactory-matching-client";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { getPrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import { loadPrintfactoryMatchingRecords } from "@/lib/printfactory/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MatchingTab =
  | "needs_job_match"
  | "needs_item_match"
  | "confirmed"
  | "ignored";

type PrintfactoryMatchingPageProps = {
  searchParams: Promise<{
    tab?: string;
    job?: string;
  }>;
};

function parseTab(value: string | undefined): MatchingTab {
  if (
    value === "needs_item_match" ||
    value === "confirmed" ||
    value === "ignored"
  ) {
    return value;
  }

  return "needs_job_match";
}

export default async function PrintfactoryMatchingPage({
  searchParams,
}: PrintfactoryMatchingPageProps) {
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const jobFilter = params.job?.trim() || undefined;

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    "/admin/production/printfactory-unmatched"
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);
  const adminClient = createAdminClient();
  const connection = getPrintfactoryConnectionStatus();

  const { records, schemaMissing } = await loadPrintfactoryMatchingRecords(
    adminClient,
    tab
  );

  const needsItemMatchRecords =
    tab === "needs_item_match"
      ? records.filter((record) => {
          const links = (record.printfactory_job_manifest_items ?? []) as Array<{
            link_status: string;
          }>;

          const hasConfirmed = links.some(
            (link) => link.link_status === "confirmed"
          );

          return !hasConfirmed;
        })
      : records;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Production"
          title="PrintFactory Matching"
          description="Review PrintFactory jobs, match them to Candid jobs via Synology paths, and confirm manifest item links manually."
          actions={
            <Link href="/admin/production">
              <Button variant="outline">Production Board</Button>
            </Link>
          }
        />

        {!connection.configured ? (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            PrintFactory is not configured. Set{" "}
            <code className="text-xs">PRINTFACTORY_API_BASE_URL</code> and{" "}
            <code className="text-xs">PRINTFACTORY_API_TOKEN</code> before syncing.
          </div>
        ) : null}

        <PrintfactoryMatchingClient
          initialTab={tab}
          records={needsItemMatchRecords as never[]}
          schemaMissing={schemaMissing}
          jobFilter={jobFilter}
          connectionStatus={connection}
        />
      </div>
    </AppShell>
  );
}
