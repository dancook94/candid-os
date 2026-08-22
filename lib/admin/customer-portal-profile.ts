import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerPortalProfile = {
  id: string;
  full_name: string | null;
  requested_company_name: string | null;
  account_status: string;
  company_id: string | null;
  company_name: string | null;
};

export async function fetchCustomerPortalProfileById(
  adminClient: SupabaseClient,
  profileId: string
): Promise<CustomerPortalProfile | null> {
  const { data, error } = await adminClient
    .from("profiles")
    .select(
      "id, full_name, requested_company_name, account_status, company_id, companies(company_name)"
    )
    .eq("id", profileId)
    .eq("user_role", "customer")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const company = Array.isArray(data.companies)
    ? (data.companies[0] ?? null)
    : data.companies;

  return {
    id: data.id as string,
    full_name: (data.full_name as string | null) ?? null,
    requested_company_name: (data.requested_company_name as string | null) ?? null,
    account_status: data.account_status as string,
    company_id: (data.company_id as string | null) ?? null,
    company_name: (company?.company_name as string | null) ?? null,
  };
}

export async function fetchApprovedCustomerPortalProfiles(
  adminClient: SupabaseClient,
  options: { limit?: number } = {}
) {
  const limit = options.limit ?? 50;

  const { data, error } = await adminClient
    .from("profiles")
    .select(
      "id, full_name, requested_company_name, account_status, company_id, updated_at, companies(company_name)"
    )
    .eq("user_role", "customer")
    .eq("account_status", "approved")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { profiles: [] as CustomerPortalProfile[], queryError: error.message };
  }

  return {
    profiles: (data ?? []).map((row) => {
      const company = Array.isArray(row.companies)
        ? (row.companies[0] ?? null)
        : row.companies;

      return {
        id: row.id as string,
        full_name: (row.full_name as string | null) ?? null,
        requested_company_name: (row.requested_company_name as string | null) ?? null,
        account_status: row.account_status as string,
        company_id: (row.company_id as string | null) ?? null,
        company_name: (company?.company_name as string | null) ?? null,
      };
    }),
    queryError: null as string | null,
  };
}
