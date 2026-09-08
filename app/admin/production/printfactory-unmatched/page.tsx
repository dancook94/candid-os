import Link from "next/link";

import { PrintfactoryMatchingClient } from "@/components/production/printfactory-matching-client";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { getPrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import {
  EXCEPTION_QUEUE_TAB_LABELS,
  normalizeExceptionQueueTab,
  type ExceptionQueueTab,
} from "@/lib/printfactory/matching-queue";
import { loadPrintfactoryMatchingRecords } from "@/lib/printfactory/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PrintfactoryMatchingPageProps = {
  searchParams: Promise<{
    tab?: string;
    job?: string;
    historical?: string;
    from?: string;
    to?: string;
  }>;
};

function parseTab(value: string | undefined): ExceptionQueueTab {
  return normalizeExceptionQueueTab(value);
}

export default async function PrintfactoryMatchingPage({
  searchParams,
}: PrintfactoryMatchingPageProps) {
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const jobFilter = params.job?.trim() || undefined;
  const includeHistorical = params.historical === "1";
  const dateFrom = params.from?.trim() || undefined;
  const dateTo = params.to?.trim() || undefined;

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    "/admin/production/printfactory-unmatched"
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);
  const adminClient = createAdminClient();
  const connection = getPrintfactoryConnectionStatus();

  const {
    records,
    schemaMissing,
    schemaMissingMessage,
    dataQueryError,
    tabCounts,
    goLiveDate,
    allRecordsCount,
    operationalRecordsCount,
  } = await loadPrintfactoryMatchingRecords(adminClient, tab, {
    includeHistorical,
    dateFrom,
    dateTo,
  });

  const { data: companies } = await supabase
    .from("companies")
    .select("id, company_name")
    .eq("is_active", true)
    .order("company_name");

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Production"
          title="PrintFactory Matching"
          description="Review unmatched PrintFactory jobs from go-live onward. Assign to existing Candid jobs, create standalone jobs, or ignore noise."
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
          records={records as never[]}
          tabCounts={tabCounts}
          schemaMissing={schemaMissing}
          schemaMissingMessage={schemaMissingMessage}
          dataQueryError={dataQueryError}
          jobFilter={jobFilter}
          connectionStatus={connection}
          tabLabels={EXCEPTION_QUEUE_TAB_LABELS}
          goLiveDate={goLiveDate}
          includeHistorical={includeHistorical}
          dateFrom={dateFrom}
          dateTo={dateTo}
          allRecordsCount={allRecordsCount ?? 0}
          operationalRecordsCount={operationalRecordsCount ?? 0}
          companies={(companies ?? []).map((company) => ({
            id: company.id,
            companyName: company.company_name ?? "Unknown company",
          }))}
        />
      </div>
    </AppShell>
  );
}
