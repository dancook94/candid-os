import type { SupabaseClient } from "@supabase/supabase-js";

export type ValidatedContact = {
  id: string;
  company_id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  is_active: boolean;
  profile_id: string | null;
};

export type ContactValidationResult =
  | { ok: true; contact: ValidatedContact }
  | { ok: false; message: string };

export async function validateActiveContactForCompany(
  supabase: SupabaseClient,
  contactId: string | null | undefined,
  companyId: string | null | undefined,
  { required = true }: { required?: boolean } = {}
): Promise<ContactValidationResult> {
  if (!contactId?.trim()) {
    if (required) {
      return { ok: false, message: "Contact is required." };
    }

    return {
      ok: true,
      contact: {
        id: "",
        company_id: companyId ?? "",
        full_name: "",
        email: null,
        job_title: null,
        is_active: true,
        profile_id: null,
      },
    };
  }

  if (!companyId?.trim()) {
    return { ok: false, message: "Company is required before selecting a contact." };
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, company_id, full_name, email, job_title, is_active, profile_id")
    .eq("id", contactId.trim())
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }

  if (!contact) {
    return { ok: false, message: "Contact not found." };
  }

  if (!contact.is_active) {
    return { ok: false, message: "Contact must be active." };
  }

  if (contact.company_id !== companyId.trim()) {
    return {
      ok: false,
      message: "Contact must belong to the selected company.",
    };
  }

  return { ok: true, contact: contact as ValidatedContact };
}

export async function validateQuoteContactAgainstOpportunity(
  supabase: SupabaseClient,
  contactId: string,
  opportunityId: string | null | undefined
): Promise<ContactValidationResult> {
  if (!opportunityId?.trim()) {
    return { ok: true, contact: { id: contactId } as ValidatedContact };
  }

  const { data: opportunity, error } = await supabase
    .from("opportunities")
    .select("contact_id")
    .eq("id", opportunityId.trim())
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }

  if (!opportunity) {
    return { ok: false, message: "Linked opportunity not found." };
  }

  if (
    opportunity.contact_id &&
    opportunity.contact_id !== contactId
  ) {
    return {
      ok: false,
      message:
        "Quote contact must match the linked opportunity contact, or choose a different contact from the same company where allowed.",
    };
  }

  return { ok: true, contact: { id: contactId } as ValidatedContact };
}
