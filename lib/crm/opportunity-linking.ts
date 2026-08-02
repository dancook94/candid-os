import type { SupabaseClient } from "@supabase/supabase-js";

import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import type { OpportunitySource } from "@/lib/crm/types";

export async function resolveDefaultOpportunityOwnerId(
  supabase: SupabaseClient,
  fallbackUserId?: string
): Promise<string> {
  const configuredOwnerId = process.env.CRM_DEFAULT_OWNER_PROFILE_ID?.trim();

  if (configuredOwnerId) {
    const { data: configuredOwner } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", configuredOwnerId)
      .eq("account_status", "approved")
      .in("user_role", ["super_admin", "admin"])
      .maybeSingle();

    if (configuredOwner) {
      return configuredOwner.id;
    }
  }

  const { data: superAdmin } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_role", "super_admin")
    .eq("account_status", "approved")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (superAdmin) {
    return superAdmin.id;
  }

  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_role", "admin")
    .eq("account_status", "approved")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (admin) {
    return admin.id;
  }

  if (fallbackUserId) {
    const { data: fallbackProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", fallbackUserId)
      .eq("account_status", "approved")
      .in("user_role", ["super_admin", "admin", "sales"])
      .maybeSingle();

    if (fallbackProfile) {
      return fallbackProfile.id;
    }
  }

  throw new Error(
    "No default CRM owner is configured. Set CRM_DEFAULT_OWNER_PROFILE_ID or ensure an approved admin exists."
  );
}

export async function createOpportunityFromQuoteRequest(
  supabase: SupabaseClient,
  {
    quoteRequestId,
    createdBy,
  }: {
    quoteRequestId: string;
    createdBy: string;
  }
) {
  const { data: quoteRequest, error: requestError } = await supabase
    .from("quote_requests")
    .select("id, company_id, project_name, description, opportunity_id")
    .eq("id", quoteRequestId)
    .maybeSingle();

  if (requestError) {
    throw new Error(requestError.message);
  }

  if (!quoteRequest) {
    throw new Error("Quote request not found.");
  }

  if (quoteRequest.opportunity_id) {
    return { opportunityId: quoteRequest.opportunity_id, created: false };
  }

  const ownerProfileId = await resolveDefaultOpportunityOwnerId(
    supabase,
    createdBy
  );

  const { data: opportunity, error: insertError } = await supabase
    .from("opportunities")
    .insert({
      company_id: quoteRequest.company_id,
      title: quoteRequest.project_name,
      description: quoteRequest.description,
      stage: "new_enquiry",
      source: "customer_portal" satisfies OpportunitySource,
      owner_profile_id: ownerProfileId,
      created_by: createdBy,
      currency: "GBP",
    })
    .select("id")
    .single();

  if (insertError || !opportunity) {
    throw new Error(insertError?.message ?? "Unable to create opportunity.");
  }

  const { error: linkError } = await supabase
    .from("quote_requests")
    .update({ opportunity_id: opportunity.id })
    .eq("id", quoteRequestId)
    .is("opportunity_id", null);

  if (linkError) {
    throw new Error(linkError.message);
  }

  await logOpportunityActivity(supabase, {
    opportunityId: opportunity.id,
    activityType: OPPORTUNITY_ACTIVITY_TYPES.opportunityCreated,
    description: `Opportunity created from customer quote request.`,
    metadata: { quote_request_id: quoteRequestId },
    createdBy,
  });

  return { opportunityId: opportunity.id, created: true };
}

export async function createOpportunityForQuote(
  supabase: SupabaseClient,
  {
    companyId,
    title,
    description,
    createdBy,
  }: {
    companyId: string;
    title: string;
    description?: string | null;
    createdBy: string;
  }
) {
  const ownerProfileId = await resolveDefaultOpportunityOwnerId(
    supabase,
    createdBy
  );

  const { data: opportunity, error } = await supabase
    .from("opportunities")
    .insert({
      company_id: companyId,
      title,
      description: description?.trim() || null,
      stage: "quote_in_progress",
      source: "admin",
      owner_profile_id: ownerProfileId,
      created_by: createdBy,
      currency: "GBP",
      won_at: null,
      lost_at: null,
    })
    .select("id")
    .single();

  if (error || !opportunity) {
    throw new Error(error?.message ?? "Unable to create opportunity.");
  }

  await logOpportunityActivity(supabase, {
    opportunityId: opportunity.id,
    activityType: OPPORTUNITY_ACTIVITY_TYPES.opportunityCreated,
    description: `Opportunity "${title}" created for quote.`,
    metadata: {},
    createdBy,
  });

  return opportunity.id;
}

export async function getActiveQuotesForOpportunity(
  supabase: SupabaseClient,
  opportunityId: string
) {
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, quote_number, project_name, status")
    .eq("opportunity_id", opportunityId)
    .in("status", ["draft", "sent"])
    .order("updated_at", { ascending: false });

  return quotes ?? [];
}
