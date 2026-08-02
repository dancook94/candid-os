import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FALLBACK_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettings,
} from "@/lib/app-settings";

const APP_SETTINGS_SELECT = `
  id,
  company_name,
  address_line_1,
  address_line_2,
  address_city,
  address_postcode,
  telephone,
  website,
  company_number,
  vat_number,
  accounts_email,
  quote_email_sender_name,
  quote_email_sender_address,
  default_payment_terms_days,
  default_quote_expiry_days,
  default_vat_rate,
  default_introduction,
  default_customer_notes,
  quote_number_prefix,
  show_product_images_by_default,
  accent_colour,
  default_company_payment_terms_days,
  default_registration_account_status,
  default_deadline_status,
  updated_at
`;

export async function loadAppSettings(
  supabase: SupabaseClient
): Promise<{ settings: AppSettings; error: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select(APP_SETTINGS_SELECT)
    .eq("singleton", true)
    .maybeSingle();

  if (error) {
    return {
      settings: FALLBACK_APP_SETTINGS,
      error: error.message,
    };
  }

  return {
    settings: normalizeAppSettings(data),
    error: null,
  };
}
