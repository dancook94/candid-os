const DEFAULT_PAYMENT_TERMS_DAYS = 14;

export function resolvePaymentTermsDays(
  paymentTermsDays: number | null | undefined
) {
  if (paymentTermsDays === null || paymentTermsDays === undefined) {
    return DEFAULT_PAYMENT_TERMS_DAYS;
  }

  return paymentTermsDays;
}

export function formatPaymentTermsLabel(
  paymentTermsDays: number | null | undefined
) {
  const resolvedDays = resolvePaymentTermsDays(paymentTermsDays);

  if (resolvedDays === 0) {
    return "Payment due immediately";
  }

  return `${resolvedDays} days`;
}

export const COMMON_PAYMENT_TERMS_DAYS = [0, 7, 14, 30, 45, 60, 90] as const;

export const PAYMENT_TERMS_MIN_DAYS = 0;
export const PAYMENT_TERMS_MAX_DAYS = 365;
