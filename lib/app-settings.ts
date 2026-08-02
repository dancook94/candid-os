export type AppSettings = {
  id: string;
  company_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_postcode: string | null;
  telephone: string | null;
  website: string | null;
  company_number: string | null;
  vat_number: string | null;
  accounts_email: string | null;
  quote_email_sender_name: string | null;
  quote_email_sender_address: string | null;
  default_payment_terms_days: number;
  default_quote_expiry_days: number;
  default_vat_rate: number;
  default_introduction: string | null;
  default_customer_notes: string | null;
  quote_number_prefix: string;
  show_product_images_by_default: boolean;
  accent_colour: string;
  default_company_payment_terms_days: number;
  default_registration_account_status: string;
  default_deadline_status: string;
  updated_at: string | null;
};

export const FALLBACK_APP_SETTINGS: AppSettings = {
  id: "",
  company_name: "Candid Creative Limited",
  address_line_1: "Innovation House",
  address_line_2: "Cray Road, Sidcup",
  address_city: null,
  address_postcode: "DA14 5DP",
  telephone: "020 3149 8995",
  website: "www.candidcreative.uk",
  company_number: "15150018",
  vat_number: "451 8762 73",
  accounts_email: "accounts@candidcreative.uk",
  quote_email_sender_name: "Candid Creative",
  quote_email_sender_address: "quotes@candidcreative.uk",
  default_payment_terms_days: 14,
  default_quote_expiry_days: 30,
  default_vat_rate: 0.2,
  default_introduction: null,
  default_customer_notes: null,
  quote_number_prefix: "Q-",
  show_product_images_by_default: true,
  accent_colour: "#fbd12c",
  default_company_payment_terms_days: 14,
  default_registration_account_status: "pending",
  default_deadline_status: "pending",
  updated_at: null,
};

export type EmailConfigStatus = {
  resendConfigured: boolean;
  appUrlConfigured: boolean;
  senderAddress: string;
  replyToAddress: string;
};

export function getEmailConfigStatus(settings: AppSettings): EmailConfigStatus {
  const senderAddress =
    settings.quote_email_sender_address ??
    FALLBACK_APP_SETTINGS.quote_email_sender_address!;

  return {
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    appUrlConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    senderAddress,
    replyToAddress: settings.accounts_email ?? FALLBACK_APP_SETTINGS.accounts_email!,
  };
}

export function formatSettingsAddress(settings: AppSettings) {
  return [
    settings.address_line_1,
    settings.address_line_2,
    settings.address_city,
    settings.address_postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function computeDefaultQuoteExpiryDate(expiryDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + expiryDays);
  return date.toISOString().slice(0, 10);
}

export function normalizeAppSettings(
  row: Partial<AppSettings> | null | undefined
): AppSettings {
  if (!row) {
    return FALLBACK_APP_SETTINGS;
  }

  return {
    ...FALLBACK_APP_SETTINGS,
    ...row,
    default_vat_rate: Number(row.default_vat_rate ?? FALLBACK_APP_SETTINGS.default_vat_rate),
    default_payment_terms_days: Number(
      row.default_payment_terms_days ?? FALLBACK_APP_SETTINGS.default_payment_terms_days
    ),
    default_quote_expiry_days: Number(
      row.default_quote_expiry_days ?? FALLBACK_APP_SETTINGS.default_quote_expiry_days
    ),
    default_company_payment_terms_days: Number(
      row.default_company_payment_terms_days ??
        FALLBACK_APP_SETTINGS.default_company_payment_terms_days
    ),
  };
}
