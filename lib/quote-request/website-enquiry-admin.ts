import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { findDuplicateContactEmail, normalizeContactEmail } from "@/lib/crm/contacts";
import { parsePaymentTermsDays } from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/server";

export class WebsiteEnquiryError extends Error {
  readonly status: number;
  readonly companyId?: string;
  readonly contactId?: string;
  readonly existingCompanyId?: string;
  readonly duplicateContactId?: string;

  constructor(
    message: string,
    status: number,
    details: {
      companyId?: string;
      contactId?: string;
      existingCompanyId?: string;
      duplicateContactId?: string;
    } = {}
  ) {
    super(message);
    this.name = "WebsiteEnquiryError";
    this.status = status;
    this.companyId = details.companyId;
    this.contactId = details.contactId;
    this.existingCompanyId = details.existingCompanyId;
    this.duplicateContactId = details.duplicateContactId;
  }
}

type EnquiryRow = {
  id: string;
  source: string | null;
  company_id: string | null;
  requested_by: string | null;
  opportunity_id: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
  submitter_phone?: string | null;
};

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

type HandlerOptions = {
  createSupabase?: () => Promise<SupabaseClient>;
  verifyAdmin?: (supabase: SupabaseClient) => Promise<AuthResult>;
};

export function normalizeCompanyName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function companyNamesMatch(left: string, right: string) {
  return normalizeCompanyName(left).toLowerCase() === normalizeCompanyName(right).toLowerCase();
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof WebsiteEnquiryError) {
    return json(
      {
        error: error.message,
        ...(error.companyId ? { companyId: error.companyId } : {}),
        ...(error.contactId ? { contactId: error.contactId } : {}),
        ...(error.existingCompanyId ? { existingCompanyId: error.existingCompanyId } : {}),
        ...(error.duplicateContactId ? { duplicateContactId: error.duplicateContactId } : {}),
      },
      error.status
    );
  }

  console.error("[website enquiry] update failed");
  return json({ error: "The enquiry could not be updated." }, 500);
}

function readObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebsiteEnquiryError("The request body must be a JSON object.", 400);
  }

  return value as Record<string, unknown>;
}

function rejectUnexpected(body: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new WebsiteEnquiryError("The request contains an unexpected property.", 400);
  }
}

function requireConfirmation(value: unknown, message: string) {
  if (value !== true) {
    throw new WebsiteEnquiryError(message, 400);
  }
}

async function loadEnquiry(supabase: SupabaseClient, quoteRequestId: string) {
  const { data, error } = await supabase
    .from("quote_requests")
    .select(
      "id, source, company_id, requested_by, opportunity_id, submitter_name, submitter_email, submitter_phone"
    )
    .eq("id", quoteRequestId)
    .maybeSingle();

  if (error) {
    throw new WebsiteEnquiryError("The enquiry could not be loaded.", 500);
  }

  if (!data) {
    throw new WebsiteEnquiryError("Quote request not found.", 404);
  }

  return data as EnquiryRow;
}

function assertWebsiteEnquiry(enquiry: EnquiryRow) {
  if (enquiry.source !== "website" || enquiry.requested_by) {
    throw new WebsiteEnquiryError("Only a website enquiry can be updated from this action.", 400);
  }
}

async function linkedQuoteId(supabase: SupabaseClient, quoteRequestId: string) {
  const { data, error } = await supabase
    .from("quotes")
    .select("id")
    .eq("quote_request_id", quoteRequestId)
    .limit(1);

  if (error) {
    throw new WebsiteEnquiryError("The enquiry could not be checked for an existing quotation.", 500);
  }

  return data?.[0]?.id ?? null;
}

async function recordActivity(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    contactId?: string | null;
    activityType: string;
    description: string;
    quoteRequestId: string;
    actorProfileId: string;
  }
) {
  try {
    await createCrmActivity(supabase, {
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      activityType: input.activityType,
      description: input.description,
      metadata: { quote_request_id: input.quoteRequestId },
      actorProfileId: input.actorProfileId,
    });
  } catch {
    console.error("[website enquiry] activity failed", {
      activityType: input.activityType,
      quoteRequestId: input.quoteRequestId,
    });
  }
}

export async function linkWebsiteEnquiryCompany(
  supabase: SupabaseClient,
  input: {
    quoteRequestId: string;
    companyId: string;
    confirmed: boolean;
    actorProfileId: string;
  }
) {
  requireConfirmation(input.confirmed, "Confirm the company before linking it.");

  const companyId = input.companyId.trim();

  if (!companyId) {
    throw new WebsiteEnquiryError("Choose a company to link.", 400);
  }

  const enquiry = await loadEnquiry(supabase, input.quoteRequestId);
  assertWebsiteEnquiry(enquiry);

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, company_name, is_active")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError || !company) {
    throw new WebsiteEnquiryError("Choose an existing company.", 400);
  }

  if (!company.is_active) {
    throw new WebsiteEnquiryError("This company is inactive.", 400);
  }

  if (enquiry.company_id === company.id) {
    return { companyId: company.id, alreadyLinked: true as const };
  }

  if (enquiry.opportunity_id) {
    throw new WebsiteEnquiryError(
      "This enquiry already has an opportunity, so its company cannot be changed.",
      409
    );
  }

  if (await linkedQuoteId(supabase, enquiry.id)) {
    throw new WebsiteEnquiryError(
      "This enquiry already has a quotation, so its company cannot be changed.",
      409
    );
  }

  const { data: linked, error: linkError } = await supabase
    .from("quote_requests")
    .update({ company_id: company.id })
    .eq("id", enquiry.id)
    .eq("source", "website")
    .is("requested_by", null)
    .is("opportunity_id", null)
    .select("id, source, company_id, requested_by")
    .maybeSingle();

  if (linkError || !linked) {
    throw new WebsiteEnquiryError("The company could not be linked.", 409);
  }

  if (linked.source !== "website" || linked.requested_by || linked.company_id !== company.id) {
    throw new WebsiteEnquiryError("The company could not be linked.", 409);
  }

  await recordActivity(supabase, {
    companyId: company.id,
    activityType: CRM_ACTIVITY_TYPES.quoteRequestCompanyLinked,
    description: `${company.company_name} was linked to a website enquiry.`,
    quoteRequestId: enquiry.id,
    actorProfileId: input.actorProfileId,
  });

  return { companyId: company.id, alreadyLinked: false as const };
}

async function findDuplicateCompany(supabase: SupabaseClient, companyName: string) {
  const { data, error } = await supabase.from("companies").select("id, company_name, is_active");

  if (error) {
    throw new WebsiteEnquiryError("Existing companies could not be checked.", 500);
  }

  return (data ?? []).find((company) => companyNamesMatch(company.company_name, companyName)) ?? null;
}

export async function createCompanyForWebsiteEnquiry(
  supabase: SupabaseClient,
  input: {
    quoteRequestId: string;
    companyName: string;
    tradingName?: string | null;
    accountsEmail?: string | null;
    phone?: string | null;
    vatNumber?: string | null;
    paymentTermsDays: number;
    confirmed: boolean;
    actorProfileId: string;
  }
) {
  requireConfirmation(input.confirmed, "Confirm the company details before creating it.");

  const companyName = normalizeCompanyName(input.companyName);

  if (!companyName) {
    throw new WebsiteEnquiryError("Legal company name is required.", 400);
  }

  if (parsePaymentTermsDays(input.paymentTermsDays) !== input.paymentTermsDays) {
    throw new WebsiteEnquiryError("Payment terms are invalid.", 400);
  }

  const enquiry = await loadEnquiry(supabase, input.quoteRequestId);
  assertWebsiteEnquiry(enquiry);

  if (enquiry.company_id) {
    throw new WebsiteEnquiryError("This enquiry is already linked to a company.", 409);
  }

  if (enquiry.opportunity_id || (await linkedQuoteId(supabase, enquiry.id))) {
    throw new WebsiteEnquiryError(
      "This enquiry already has an opportunity or quotation, so a company cannot be created for it.",
      409
    );
  }

  const duplicate = await findDuplicateCompany(supabase, companyName);

  if (duplicate) {
    throw new WebsiteEnquiryError(
      duplicate.is_active
        ? "A company with this name already exists. Link that company instead of creating another."
        : "A company with this name already exists. Reactivate it instead of creating another.",
      409,
      { existingCompanyId: duplicate.id }
    );
  }

  const { data: created, error: insertError } = await supabase
    .from("companies")
    .insert({
      company_name: companyName,
      trading_name: input.tradingName?.trim() || null,
      accounts_email: input.accountsEmail?.trim() || null,
      phone: input.phone?.trim() || null,
      vat_number: input.vatNumber?.trim() || null,
      payment_terms_days: input.paymentTermsDays,
      is_active: true,
    })
    .select("id, company_name")
    .single();

  if (insertError || !created) {
    throw new WebsiteEnquiryError("The company could not be created.", 500);
  }

  await recordActivity(supabase, {
    companyId: created.id,
    activityType: CRM_ACTIVITY_TYPES.companyCreated,
    description: `${created.company_name} was created from a website enquiry.`,
    quoteRequestId: enquiry.id,
    actorProfileId: input.actorProfileId,
  });

  try {
    await linkWebsiteEnquiryCompany(supabase, {
      quoteRequestId: enquiry.id,
      companyId: created.id,
      confirmed: true,
      actorProfileId: input.actorProfileId,
    });
  } catch (error) {
    if (error instanceof WebsiteEnquiryError) {
      throw new WebsiteEnquiryError(
        "The company was created, but it could not be linked to the enquiry.",
        409,
        { companyId: created.id }
      );
    }

    throw new WebsiteEnquiryError(
      "The company was created, but it could not be linked to the enquiry.",
      409,
      { companyId: created.id }
    );
  }

  return { companyId: created.id };
}

async function opportunityContact(supabase: SupabaseClient, opportunityId: string) {
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, contact_id")
    .eq("id", opportunityId)
    .maybeSingle();

  if (error || !data) {
    throw new WebsiteEnquiryError("The linked opportunity could not be loaded.", 500);
  }

  return data as { id: string; contact_id: string | null };
}

export async function confirmWebsiteEnquiryContact(
  supabase: SupabaseClient,
  input: {
    quoteRequestId: string;
    contactId: string;
    confirmed: boolean;
    actorProfileId: string;
  }
) {
  requireConfirmation(input.confirmed, "Confirm the contact before saving it.");

  const contactId = input.contactId.trim();

  if (!contactId) {
    throw new WebsiteEnquiryError("Choose a contact.", 400);
  }

  const enquiry = await loadEnquiry(supabase, input.quoteRequestId);
  assertWebsiteEnquiry(enquiry);

  if (!enquiry.company_id) {
    throw new WebsiteEnquiryError("Link a company before choosing a contact.", 400);
  }

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, company_id, full_name, email, is_active, profile_id")
    .eq("id", contactId)
    .maybeSingle();

  if (contactError || !contact || !contact.is_active) {
    throw new WebsiteEnquiryError("Choose an active contact.", 400);
  }

  if (contact.company_id !== enquiry.company_id) {
    throw new WebsiteEnquiryError("Choose a contact that belongs to the linked company.", 400);
  }

  if (await linkedQuoteId(supabase, enquiry.id)) {
    throw new WebsiteEnquiryError(
      "This enquiry already has a quotation, so its contact cannot be changed.",
      409
    );
  }

  if (enquiry.opportunity_id) {
    const opportunity = await opportunityContact(supabase, enquiry.opportunity_id);

    if (opportunity.contact_id && opportunity.contact_id !== contact.id) {
      throw new WebsiteEnquiryError(
        "This enquiry already has an opportunity contact. Change it from the opportunity.",
        409
      );
    }

    if (!opportunity.contact_id) {
      const { error: updateError } = await supabase
        .from("opportunities")
        .update({ contact_id: contact.id })
        .eq("id", opportunity.id)
        .eq("company_id", enquiry.company_id);

      if (updateError) {
        throw new WebsiteEnquiryError("The contact could not be saved on the opportunity.", 500);
      }
    }
  }

  await recordActivity(supabase, {
    companyId: enquiry.company_id,
    contactId: contact.id,
    activityType: CRM_ACTIVITY_TYPES.quoteRequestContactConfirmed,
    description: `${contact.full_name} was confirmed as the contact for a website enquiry.`,
    quoteRequestId: enquiry.id,
    actorProfileId: input.actorProfileId,
  });

  return { contactId: contact.id };
}

export async function createContactForWebsiteEnquiry(
  supabase: SupabaseClient,
  input: {
    quoteRequestId: string;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    confirmed: boolean;
    actorProfileId: string;
  }
) {
  requireConfirmation(input.confirmed, "Confirm the contact details before creating them.");

  const fullName = input.fullName.trim();
  const email = normalizeContactEmail(input.email);

  if (!fullName) {
    throw new WebsiteEnquiryError("Full name is required.", 400);
  }

  const enquiry = await loadEnquiry(supabase, input.quoteRequestId);
  assertWebsiteEnquiry(enquiry);

  if (!enquiry.company_id) {
    throw new WebsiteEnquiryError("Link a company before creating a contact.", 400);
  }

  if (email) {
    const duplicate = await findDuplicateContactEmail(supabase, enquiry.company_id, email);

    if (duplicate) {
      throw new WebsiteEnquiryError(
        `A contact with this email already exists for this company (${duplicate.full_name}).`,
        409,
        { duplicateContactId: duplicate.id }
      );
    }
  }

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      company_id: enquiry.company_id,
      full_name: fullName,
      email,
      phone: input.phone?.trim() || null,
      is_primary: false,
      is_active: true,
      created_by: input.actorProfileId,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new WebsiteEnquiryError("The contact could not be created.", 500);
  }

  await recordActivity(supabase, {
    companyId: enquiry.company_id,
    contactId: created.id,
    activityType: CRM_ACTIVITY_TYPES.contactCreated,
    description: `${fullName} was added as a contact from a website enquiry.`,
    quoteRequestId: enquiry.id,
    actorProfileId: input.actorProfileId,
  });

  await confirmWebsiteEnquiryContact(supabase, {
    quoteRequestId: enquiry.id,
    contactId: created.id,
    confirmed: true,
    actorProfileId: input.actorProfileId,
  });

  return { contactId: created.id };
}

async function authorisedClient(options: HandlerOptions) {
  const supabase = await (options.createSupabase ?? createClient)();
  const auth = await (options.verifyAdmin ?? verifyApprovedAdmin)(supabase);

  if (!auth.ok) {
    return { ok: false as const, response: json({ error: auth.message }, auth.status) };
  }

  return { ok: true as const, supabase, actorProfileId: auth.userId };
}

async function readJson(request: Request) {
  try {
    return readObject(await request.json());
  } catch (error) {
    if (error instanceof WebsiteEnquiryError) {
      throw error;
    }

    throw new WebsiteEnquiryError("The request body must be a JSON object.", 400);
  }
}

export async function handleLinkWebsiteEnquiryCompany(
  request: Request,
  quoteRequestId: string,
  options: HandlerOptions = {}
) {
  const access = await authorisedClient(options);

  if (!access.ok) {
    return access.response;
  }

  try {
    const body = await readJson(request);
    rejectUnexpected(body, ["companyId", "confirmed"]);
    const result = await linkWebsiteEnquiryCompany(access.supabase, {
      quoteRequestId,
      companyId: typeof body.companyId === "string" ? body.companyId : "",
      confirmed: body.confirmed === true,
      actorProfileId: access.actorProfileId,
    });

    return json({ ok: true, ...result }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCreateWebsiteEnquiryCompany(
  request: Request,
  quoteRequestId: string,
  options: HandlerOptions = {}
) {
  const access = await authorisedClient(options);

  if (!access.ok) {
    return access.response;
  }

  try {
    const body = await readJson(request);
    rejectUnexpected(body, [
      "companyName",
      "tradingName",
      "accountsEmail",
      "phone",
      "vatNumber",
      "paymentTermsDays",
      "confirmed",
    ]);
    const paymentTermsDays =
      typeof body.paymentTermsDays === "number"
        ? body.paymentTermsDays
        : Number.parseInt(String(body.paymentTermsDays ?? ""), 10);
    const result = await createCompanyForWebsiteEnquiry(access.supabase, {
      quoteRequestId,
      companyName: typeof body.companyName === "string" ? body.companyName : "",
      tradingName: typeof body.tradingName === "string" ? body.tradingName : null,
      accountsEmail: typeof body.accountsEmail === "string" ? body.accountsEmail : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      vatNumber: typeof body.vatNumber === "string" ? body.vatNumber : null,
      paymentTermsDays,
      confirmed: body.confirmed === true,
      actorProfileId: access.actorProfileId,
    });

    return json({ ok: true, ...result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleConfirmWebsiteEnquiryContact(
  request: Request,
  quoteRequestId: string,
  options: HandlerOptions = {}
) {
  const access = await authorisedClient(options);

  if (!access.ok) {
    return access.response;
  }

  try {
    const body = await readJson(request);
    rejectUnexpected(body, ["contactId", "confirmed"]);
    const result = await confirmWebsiteEnquiryContact(access.supabase, {
      quoteRequestId,
      contactId: typeof body.contactId === "string" ? body.contactId : "",
      confirmed: body.confirmed === true,
      actorProfileId: access.actorProfileId,
    });

    return json({ ok: true, ...result }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCreateWebsiteEnquiryContact(
  request: Request,
  quoteRequestId: string,
  options: HandlerOptions = {}
) {
  const access = await authorisedClient(options);

  if (!access.ok) {
    return access.response;
  }

  try {
    const body = await readJson(request);
    rejectUnexpected(body, ["fullName", "email", "phone", "confirmed"]);
    const result = await createContactForWebsiteEnquiry(access.supabase, {
      quoteRequestId,
      fullName: typeof body.fullName === "string" ? body.fullName : "",
      email: typeof body.email === "string" ? body.email : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      confirmed: body.confirmed === true,
      actorProfileId: access.actorProfileId,
    });

    return json({ ok: true, ...result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
