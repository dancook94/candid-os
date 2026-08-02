import type { SupabaseClient } from "@supabase/supabase-js";

export type CompanyContactOption = {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  is_primary: boolean;
};

export async function fetchActiveCompanyContacts(
  supabase: SupabaseClient,
  companyId: string
): Promise<CompanyContactOption[]> {
  if (!companyId.trim()) {
    return [];
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("id, full_name, email, job_title, is_primary")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CompanyContactOption[];
}

export function formatCompanyContactLabel(contact: CompanyContactOption) {
  const parts = [contact.full_name];

  if (contact.job_title) {
    parts.push(contact.job_title);
  }

  if (contact.email) {
    parts.push(contact.email);
  }

  return parts.join(" · ");
}
