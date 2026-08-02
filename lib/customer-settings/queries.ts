import type { SupabaseClient } from "@supabase/supabase-js";

import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import {
  isMissingColumnError,
  logPortalSettingsQueryError,
} from "@/lib/customer-settings/query-errors";
import type { CustomerSettingsContext } from "@/lib/customer-settings/auth";

/** Columns confirmed on public.companies in the live CRM schema. */
export const COMPANY_CORE_SELECT =
  "id, company_name, trading_name, accounts_email, phone, vat_number, payment_terms_days, is_active, created_at";

const PROFILE_CORE_SELECT =
  "full_name, company_id, account_status, user_role, avatar_storage_path";

const CONTACT_CORE_SELECT =
  "id, company_id, full_name, email, phone, job_title, is_primary, is_active, updated_at";

const CUSTOMER_CONTACT_LIST_SELECT = `
  id,
  company_id,
  full_name,
  email,
  phone,
  job_title,
  is_primary,
  is_active,
  profile_id,
  created_at,
  updated_at
`;

export async function loadCompanyForSettings(
  adminClient: SupabaseClient,
  companyId: string
): Promise<CustomerSettingsContext["company"]> {
  const query = `companies.select(${COMPANY_CORE_SELECT}).eq(id).maybeSingle`;

  const { data, error } = await adminClient
    .from("companies")
    .select(COMPANY_CORE_SELECT)
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    logPortalSettingsQueryError(query, error);
    throw new CustomerSettingsError(
      error.message || "Unable to load company details.",
      500
    );
  }

  if (!data) {
    throw new CustomerSettingsError("Company not found.", 404);
  }

  return {
    ...data,
    updated_at: null,
    website: null,
    company_number: null,
  };
}

export async function loadLinkedContactForSettings(
  adminClient: SupabaseClient,
  userId: string,
  companyId: string
): Promise<CustomerSettingsContext["contact"]> {
  const query =
    "contacts.select(core).eq(profile_id).eq(company_id).maybeSingle";

  const { data, error } = await adminClient
    .from("contacts")
    .select(CONTACT_CORE_SELECT)
    .eq("profile_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    logPortalSettingsQueryError(query, error);
    throw new CustomerSettingsError(
      error.message || "Unable to load your contact record.",
      500
    );
  }

  if (!data) {
    return null;
  }

  if (data.company_id !== companyId) {
    throw new CustomerSettingsError("Forbidden.", 403);
  }

  return data;
}

export async function loadCustomerSettingsProfile(
  supabase: SupabaseClient,
  userId: string
) {
  const query = `profiles.select(${PROFILE_CORE_SELECT}, updated_at).eq(id).single`;

  const { data, error } = await supabase
    .from("profiles")
    .select(`${PROFILE_CORE_SELECT}, updated_at`)
    .eq("id", userId)
    .single();

  if (error && isMissingColumnError(error)) {
    logPortalSettingsQueryError(query, error);

    const fallbackQuery = `profiles.select(${PROFILE_CORE_SELECT}).eq(id).single`;
    const fallback = await supabase
      .from("profiles")
      .select(PROFILE_CORE_SELECT)
      .eq("id", userId)
      .single();

    if (fallback.error) {
      logPortalSettingsQueryError(fallbackQuery, fallback.error);
      return null;
    }

    return {
      ...fallback.data,
      updated_at: null,
    };
  }

  if (error) {
    logPortalSettingsQueryError(query, error);
    return null;
  }

  return data;
}

export type CustomerSettingsContactListRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  is_primary: boolean;
  isSelf: boolean;
};

export async function loadCompanyContactsForSettings(
  adminClient: SupabaseClient,
  companyId: string,
  currentUserId: string
): Promise<CustomerSettingsContactListRow[]> {
  const query = `contacts.select(company list).eq(company_id).eq(is_active)`;

  const { data, error } = await adminClient
    .from("contacts")
    .select(CUSTOMER_CONTACT_LIST_SELECT)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    logPortalSettingsQueryError(query, error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    job_title: row.job_title,
    is_primary: row.is_primary,
    isSelf: row.profile_id === currentUserId,
  }));
}
