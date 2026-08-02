import type { SupabaseClient } from "@supabase/supabase-js";

import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";

export type LinkQuoteToOpportunityResult =
  | { ok: true; opportunityId: string }
  | { ok: false; message: string };

export async function linkQuoteToOpportunity(
  supabase: SupabaseClient,
  {
    quoteId,
    opportunityId,
    linkedBy,
  }: {
    quoteId: string;
    opportunityId: string;
    linkedBy: string;
  }
): Promise<LinkQuoteToOpportunityResult> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, quote_number, company_id, opportunity_id, project_name")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return { ok: false, message: quoteError.message };
  }

  if (!quote) {
    return { ok: false, message: "Quote not found." };
  }

  if (quote.opportunity_id) {
    return {
      ok: false,
      message: "This quote is already linked to an opportunity.",
    };
  }

  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("id, company_id, title")
    .eq("id", opportunityId)
    .maybeSingle();

  if (opportunityError) {
    return { ok: false, message: opportunityError.message };
  }

  if (!opportunity) {
    return { ok: false, message: "Opportunity not found." };
  }

  if (opportunity.company_id !== quote.company_id) {
    return {
      ok: false,
      message: "Quote and opportunity must belong to the same company.",
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("quotes")
    .update({ opportunity_id: opportunityId })
    .eq("id", quoteId)
    .is("opportunity_id", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return { ok: false, message: updateError.message };
  }

  if (!updated) {
    return {
      ok: false,
      message: "Unable to link quote. It may already be linked.",
    };
  }

  await logOpportunityActivity(supabase, {
    opportunityId,
    activityType: OPPORTUNITY_ACTIVITY_TYPES.quoteLinked,
    description: `Quote Q-${quote.quote_number} linked to this opportunity.`,
    metadata: {
      quote_id: quote.id,
      quote_number: quote.quote_number,
      project_name: quote.project_name,
    },
    createdBy: linkedBy,
  });

  return { ok: true, opportunityId };
}
