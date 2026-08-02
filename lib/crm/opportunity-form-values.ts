import {
  toDateInputValue,
  toDateTimeLocalValue,
} from "@/lib/crm/format-datetime";
import type { OpportunitySource, OpportunityStage } from "@/lib/crm/types";

export type OpportunityFormValues = {
  companyId: string;
  contactId: string;
  title: string;
  description: string;
  estimatedValue: string;
  stage: OpportunityStage;
  ownerId: string;
  collaboratorIds: string[];
  source: OpportunitySource;
  expectedCloseDate: string;
  nextFollowUpAt: string;
  lostReason: string;
};

export function buildOpportunityFormInitialValues(
  opportunity: {
    company_id: string;
    contact_id: string | null;
    title: string;
    description: string | null;
    estimated_value: number | string | null;
    stage: OpportunityStage;
    owner_profile_id: string;
    source: OpportunitySource;
    expected_close_date: string | null;
    next_follow_up_at: string | null;
    lost_reason: string | null;
  },
  collaboratorIds: string[]
): Partial<OpportunityFormValues> {
  const estimated =
    opportunity.estimated_value === null ||
    opportunity.estimated_value === undefined
      ? ""
      : String(opportunity.estimated_value);

  return {
    companyId: opportunity.company_id,
    contactId: opportunity.contact_id ?? "",
    title: opportunity.title,
    description: opportunity.description ?? "",
    estimatedValue: estimated,
    stage: opportunity.stage,
    ownerId: opportunity.owner_profile_id,
    collaboratorIds,
    source: opportunity.source,
    expectedCloseDate: toDateInputValue(opportunity.expected_close_date),
    nextFollowUpAt: toDateTimeLocalValue(opportunity.next_follow_up_at),
    lostReason: opportunity.lost_reason ?? "",
  };
}
