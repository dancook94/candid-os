import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  isJobInvoiceExcluded,
  type JobBillingType,
} from "@/lib/jobs/billing-types";
import type { JobProductionBoardStage } from "@/lib/production/job-board-constants";

export type JobBoardArchiveFields = {
  production_board_stage: JobProductionBoardStage | string | null;
  job_billing_type?: JobBillingType | string | null;
};

/** Internal / FOC jobs completed on the board — hidden from the active board, retained in history. */
export function isJobArchivedFromProductionBoard(
  job: JobBoardArchiveFields
): boolean {
  return (
    job.production_board_stage === "complete_job" &&
    isJobInvoiceExcluded(job.job_billing_type as JobBillingType | null | undefined)
  );
}

export function buildNonBillableProductionCloseoutUpdates(
  job: JobBoardArchiveFields,
  newStage: JobProductionBoardStage
) {
  if (
    newStage !== "complete_job" ||
    !isJobInvoiceExcluded(job.job_billing_type as JobBillingType | null | undefined)
  ) {
    return null;
  }

  return {
    commercial_status: "not_invoiceable" as const,
    status: "completed" as const,
  };
}

export async function logNonBillableProductionBoardArchive(
  adminClient: SupabaseClient,
  job: {
    id: string;
    job_reference: string;
    company_id: string;
    contact_id: string | null;
    opportunity_id: string | null;
    quote_id: string | null;
    job_billing_type?: JobBillingType | string | null;
  },
  actorProfileId: string
) {
  const billingLabel =
    job.job_billing_type === "internal" ? "Internal" : "Non-billable / FOC";

  await createCrmActivity(adminClient, {
    companyId: job.company_id,
    contactId: job.contact_id,
    opportunityId: job.opportunity_id,
    quoteId: job.quote_id,
    activityType: "production_board_job_archived",
    description: `${billingLabel} job ${job.job_reference} completed and removed from the active Production Board.`,
    actorProfileId,
    metadata: {
      job_id: job.id,
      job_billing_type: job.job_billing_type,
      archived_from: "complete_job",
    },
    validatedLinks: {
      companyId: job.company_id,
      contactId: job.contact_id,
      opportunityId: job.opportunity_id,
      quoteId: job.quote_id,
      taskId: null,
    },
  });
}
