export const JOB_BILLING_TYPES = ["billable", "non_billable", "internal"] as const;

export type JobBillingType = (typeof JOB_BILLING_TYPES)[number];

export const JOB_ORIGINS = ["quote", "printfactory", "manual"] as const;

export type JobOrigin = (typeof JOB_ORIGINS)[number];

export const JOB_BILLING_TYPE_LABELS: Record<JobBillingType, string> = {
  billable: "Billable",
  non_billable: "Non-billable / FOC",
  internal: "Internal",
};

export function isJobInvoiceExcluded(billingType: JobBillingType | null | undefined) {
  return billingType === "non_billable" || billingType === "internal";
}

export function resolveCommercialStatusForBillingType(
  billingType: JobBillingType
): "not_ready" | "not_invoiceable" {
  return billingType === "billable" ? "not_ready" : "not_invoiceable";
}
