const DEFAULT_PAYMENT_TERMS_DAYS = 14;

export function resolveQuotePaymentTermsDays(
  companyPaymentTermsDays: number | null | undefined,
  settingsFallbackDays?: number | null
) {
  if (companyPaymentTermsDays !== null && companyPaymentTermsDays !== undefined) {
    return companyPaymentTermsDays;
  }

  if (settingsFallbackDays !== null && settingsFallbackDays !== undefined) {
    return settingsFallbackDays;
  }

  return DEFAULT_PAYMENT_TERMS_DAYS;
}

export function resolvePaymentTermsDays(
  paymentTermsDays: number | null | undefined
) {
  return resolveQuotePaymentTermsDays(paymentTermsDays);
}

export function parsePaymentTermsDays(value: string | number) {
  const parsed =
    typeof value === "string" ? Number.parseInt(value.trim(), 10) : value;

  if (!Number.isInteger(parsed) || parsed < PAYMENT_TERMS_MIN_DAYS) {
    return null;
  }

  if (parsed > PAYMENT_TERMS_MAX_DAYS) {
    return null;
  }

  return parsed;
}

export function formatPaymentTermsLabel(
  paymentTermsDays: number | null | undefined
) {
  const resolvedDays = resolvePaymentTermsDays(paymentTermsDays);

  if (resolvedDays === 0) {
    return "Due immediately";
  }

  return `${resolvedDays} days`;
}

export const COMMON_PAYMENT_TERMS_DAYS = [0, 7, 14, 30, 45, 60, 90] as const;

export const PAYMENT_TERMS_MIN_DAYS = 0;
export const PAYMENT_TERMS_MAX_DAYS = 365;
