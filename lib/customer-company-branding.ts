import type { SupabaseClient } from "@supabase/supabase-js";

import { createCompanyLogoSignedUrl } from "@/lib/company-logos";

export type CustomerCompanyBranding = {
  companyName: string;
  companyLogoUrl: string | null;
};

export async function loadCustomerCompanyBranding(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  fallbackCompanyName: string
): Promise<CustomerCompanyBranding> {
  if (!companyId) {
    return {
      companyName: fallbackCompanyName,
      companyLogoUrl: null,
    };
  }

  const { data: company } = await supabase
    .from("companies")
    .select("company_name, logo_storage_path")
    .eq("id", companyId)
    .maybeSingle();

  if (!company) {
    return {
      companyName: fallbackCompanyName,
      companyLogoUrl: null,
    };
  }

  const companyLogoUrl = company.logo_storage_path
    ? await createCompanyLogoSignedUrl(supabase, company.logo_storage_path)
    : null;

  return {
    companyName: company.company_name || fallbackCompanyName,
    companyLogoUrl,
  };
}
