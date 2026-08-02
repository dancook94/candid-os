import type { SupabaseClient } from "@supabase/supabase-js";

export type CrmRecordLinks = {
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  quoteId?: string | null;
  taskId?: string | null;
};

export type ValidatedCrmLinks = {
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  quoteId: string | null;
  taskId: string | null;
};

type ValidationResult =
  | { ok: true; links: ValidatedCrmLinks }
  | { ok: false; message: string };

function hasAtLeastOneLink(links: CrmRecordLinks) {
  return Boolean(
    links.companyId ||
      links.contactId ||
      links.opportunityId ||
      links.quoteId ||
      links.taskId
  );
}

export async function validateCrmLinks(
  supabase: SupabaseClient,
  input: CrmRecordLinks
): Promise<ValidationResult> {
  if (!hasAtLeastOneLink(input)) {
    return { ok: false, message: "At least one linked CRM record is required." };
  }

  const links: ValidatedCrmLinks = {
    companyId: input.companyId?.trim() || null,
    contactId: input.contactId?.trim() || null,
    opportunityId: input.opportunityId?.trim() || null,
    quoteId: input.quoteId?.trim() || null,
    taskId: input.taskId?.trim() || null,
  };

  if (links.opportunityId) {
    const { data: opportunity, error } = await supabase
      .from("opportunities")
      .select("id, company_id")
      .eq("id", links.opportunityId)
      .maybeSingle();

    if (error) {
      return { ok: false, message: error.message };
    }

    if (!opportunity) {
      return { ok: false, message: "Linked opportunity not found." };
    }

    if (
      links.companyId &&
      opportunity.company_id !== links.companyId
    ) {
      return {
        ok: false,
        message: "Opportunity must belong to the linked company.",
      };
    }

    links.companyId = links.companyId ?? opportunity.company_id;
  }

  if (links.quoteId) {
    const { data: quote, error } = await supabase
      .from("quotes")
      .select("id, company_id, opportunity_id, contact_id")
      .eq("id", links.quoteId)
      .maybeSingle();

    if (error) {
      return { ok: false, message: error.message };
    }

    if (!quote) {
      return { ok: false, message: "Linked quote not found." };
    }

    if (links.companyId && quote.company_id !== links.companyId) {
      return { ok: false, message: "Quote must belong to the linked company." };
    }

    if (
      links.opportunityId &&
      quote.opportunity_id &&
      quote.opportunity_id !== links.opportunityId
    ) {
      return {
        ok: false,
        message: "Quote must belong to the linked opportunity.",
      };
    }

    links.companyId = links.companyId ?? quote.company_id;
    links.opportunityId = links.opportunityId ?? quote.opportunity_id;
    links.contactId = links.contactId ?? quote.contact_id;
  }

  if (links.contactId) {
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("id, company_id, is_active")
      .eq("id", links.contactId)
      .maybeSingle();

    if (error) {
      return { ok: false, message: error.message };
    }

    if (!contact) {
      return { ok: false, message: "Linked contact not found." };
    }

    if (links.companyId && contact.company_id !== links.companyId) {
      return { ok: false, message: "Contact must belong to the linked company." };
    }

    links.companyId = links.companyId ?? contact.company_id;
  }

  if (links.taskId) {
    const { data: task, error } = await supabase
      .from("tasks")
      .select("id, company_id, opportunity_id, quote_id")
      .eq("id", links.taskId)
      .maybeSingle();

    if (error) {
      return { ok: false, message: error.message };
    }

    if (!task) {
      return { ok: false, message: "Linked task not found." };
    }

    if (links.companyId && task.company_id && task.company_id !== links.companyId) {
      return { ok: false, message: "Task must belong to the linked company." };
    }

    if (
      links.opportunityId &&
      task.opportunity_id &&
      task.opportunity_id !== links.opportunityId
    ) {
      return {
        ok: false,
        message: "Task must belong to the linked opportunity.",
      };
    }

    if (links.quoteId && task.quote_id && task.quote_id !== links.quoteId) {
      return { ok: false, message: "Task must belong to the linked quote." };
    }

    links.companyId = links.companyId ?? task.company_id;
    links.opportunityId = links.opportunityId ?? task.opportunity_id;
    links.quoteId = links.quoteId ?? task.quote_id;
  }

  if (!links.companyId && !links.contactId && !links.opportunityId && !links.quoteId && !links.taskId) {
    return { ok: false, message: "Unable to resolve CRM record links." };
  }

  return { ok: true, links };
}
