import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadInvoiceReviewData,
  reconcileInvoiceDraft,
} from "@/lib/invoice/service";
import { flagUnclassifiedReprintsForJob } from "@/lib/printfactory/reprint-detection";
import { ProductionError } from "@/lib/production/errors";

export type JobCommercialCloseoutResult = {
  invoiceStatus: string;
  needsAttention: boolean;
  warnings: string[];
  reprintWarnings: string[];
};

export async function reconcileJobCommercialCloseout(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId: string
): Promise<JobCommercialCloseoutResult> {
  const warnings: string[] = [];

  try {
    await reconcileInvoiceDraft(adminClient, jobId, actorProfileId);
  } catch (error) {
    warnings.push(
      error instanceof ProductionError
        ? error.message
        : "Invoice reconciliation failed."
    );
  }

  let needsAttention = false;

  try {
    const review = await loadInvoiceReviewData(adminClient, jobId);

    needsAttention =
      !review.canApprove ||
      review.productionChangedAfterApproval ||
      review.unpricedCount > 0;

    if (review.unpricedCount > 0) {
      warnings.push(`${review.unpricedCount} billable item(s) still need pricing.`);
    }

    if (review.productionChanges.length > 0) {
      const unresolved = review.productionChanges.filter(
        (item) => item.billing_status === "price_required"
      );

      if (unresolved.length > 0) {
        warnings.push(`${unresolved.length} additional production change(s) need pricing.`);
      }
    }
  } catch (error) {
    warnings.push(
      error instanceof Error ? error.message : "Unable to load invoice review status."
    );
    needsAttention = true;
  }

  const reprintWarnings = await flagUnclassifiedReprintsForJob(adminClient, jobId);

  return {
    invoiceStatus: needsAttention ? "invoice_needs_attention" : "ready_for_invoice_review",
    needsAttention: needsAttention || reprintWarnings.length > 0,
    warnings,
    reprintWarnings,
  };
}
