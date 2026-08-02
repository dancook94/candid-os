import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isMissingRelationError,
  logPortalSettingsQueryError,
} from "@/lib/customer-settings/errors";

export type CompanyAddressRecord = {
  id: string;
  company_id: string;
  label: string | null;
  recipient_name: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string;
  country: string;
  phone: string | null;
  delivery_instructions: string | null;
  is_default_delivery: boolean;
  is_default_billing: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CompanyAddressesFeature = {
  available: boolean;
  addresses: CompanyAddressRecord[];
};

const ADDRESS_SELECT =
  "id, company_id, label, recipient_name, address_line_1, address_line_2, city, county, postcode, country, phone, delivery_instructions, is_default_delivery, is_default_billing, is_active, created_at, updated_at";

function handleAddressQueryError(query: string, error: { code?: string; message?: string; details?: string | null; hint?: string | null }) {
  logPortalSettingsQueryError(query, error);
  return { available: false, addresses: [] } satisfies CompanyAddressesFeature;
}

export async function loadCompanyAddresses(
  adminClient: SupabaseClient,
  companyId: string
): Promise<CompanyAddressesFeature> {
  const query = `company_addresses.select(${ADDRESS_SELECT}).eq(company_id).eq(is_active)`;

  const { data, error } = await adminClient
    .from("company_addresses")
    .select(ADDRESS_SELECT)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("label", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) {
      return handleAddressQueryError(query, error);
    }

    return handleAddressQueryError(query, error);
  }

  return {
    available: true,
    addresses: (data ?? []) as CompanyAddressRecord[],
  };
}

export async function loadAllCompanyAddressesForAdmin(
  adminClient: SupabaseClient,
  companyId: string
): Promise<CompanyAddressesFeature> {
  const query = `company_addresses.select(${ADDRESS_SELECT}).eq(company_id)`;

  const { data, error } = await adminClient
    .from("company_addresses")
    .select(ADDRESS_SELECT)
    .eq("company_id", companyId)
    .order("is_active", { ascending: false })
    .order("label", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) {
      return handleAddressQueryError(query, error);
    }

    return handleAddressQueryError(query, error);
  }

  return {
    available: true,
    addresses: (data ?? []) as CompanyAddressRecord[],
  };
}
