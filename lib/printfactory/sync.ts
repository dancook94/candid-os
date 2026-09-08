import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import {
  PRINTFACTORY_JOB_SELECT,
} from "@/lib/printfactory/constants";
import {
  countPrintfactoryRecordsByTab,
  filterPrintfactoryRecordsByTab,
  type ExceptionQueueTab,
} from "@/lib/printfactory/matching-queue";
import {
  checkPrintfactorySchemaReadiness,
  logMatchingDataQueryDev,
  toPrintfactoryDataQueryError,
  type PrintfactoryDataQueryError,
} from "@/lib/printfactory/schema-readiness";
import {
  filterPrintfactoryRecordsByOperationalWindow,
  getPrintfactoryMatchingGoLiveDateString,
  type PrintfactoryMatchingLoadFilters,
} from "@/lib/printfactory/matching-config";

export type { PrintfactorySyncResult } from "@/lib/printfactory/sync-engine";
export { syncLivePrintfactoryJobs, syncPrintfactoryJobs } from "@/lib/printfactory/sync-live";
export { loadPrintfactorySyncHealth } from "@/lib/printfactory/sync-health";

export async function loadPrintfactoryMatchingRecords(
  adminClient: SupabaseClient,
  tab: ExceptionQueueTab,
  filters: PrintfactoryMatchingLoadFilters = {}
) {
  if (process.env.NODE_ENV === "development") {
    noStore();
  }

  const schemaReadiness = await checkPrintfactorySchemaReadiness(adminClient);

  if (!schemaReadiness.ready) {
    return {
      records: [],
      allRecordsCount: 0,
      operationalRecordsCount: 0,
      goLiveDate: getPrintfactoryMatchingGoLiveDateString(),
      schemaMissing: true as const,
      schemaMissingMessage: schemaReadiness.message,
      dataQueryError: null as PrintfactoryDataQueryError | null,
      tabCounts: null,
    };
  }

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .select(`
    ${PRINTFACTORY_JOB_SELECT},
    raw_metadata,
    is_multi_job_sheet,
    jobs:jobs!printfactory_jobs_candid_job_id_fkey(
      id, job_reference, project_name, company_id, companies(company_name)
    ),
    printfactory_job_candid_jobs(
      id, candid_job_id, link_type, is_primary,
      jobs(id, job_reference, project_name, companies(company_name))
    ),
    printfactory_job_manifest_items(
      id, production_item_id, link_status, match_method, match_confidence,
      suggestion_reason, suggestion_details, confirmed_at,
      production_items(id, item_reference, item_name)
    )
  `)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) {
    const dataQueryError = toPrintfactoryDataQueryError(error);
    logMatchingDataQueryDev(dataQueryError);

    return {
      records: [],
      allRecordsCount: 0,
      operationalRecordsCount: 0,
      goLiveDate: getPrintfactoryMatchingGoLiveDateString(),
      schemaMissing: false as const,
      schemaMissingMessage: null,
      dataQueryError,
      tabCounts: null,
    };
  }

  const allRecords = data ?? [];
  const operationalRecords = filterPrintfactoryRecordsByOperationalWindow(
    allRecords,
    filters
  );
  const tabCounts = countPrintfactoryRecordsByTab(operationalRecords);
  const records = filterPrintfactoryRecordsByTab(operationalRecords, tab);

  return {
    records,
    allRecordsCount: allRecords.length,
    operationalRecordsCount: operationalRecords.length,
    goLiveDate: getPrintfactoryMatchingGoLiveDateString(),
    schemaMissing: false as const,
    schemaMissingMessage: null,
    dataQueryError: null as PrintfactoryDataQueryError | null,
    tabCounts,
  };
}
