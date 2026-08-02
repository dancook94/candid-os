import {
  OPPORTUNITY_SOURCES,
  type OpportunitySource,
} from "@/lib/crm/types";

export const OPPORTUNITY_SOURCE_LABELS: Record<OpportunitySource, string> = {
  customer_portal: "Customer portal",
  admin: "Admin",
  phone: "Phone",
  email: "Email",
  referral: "Referral",
  walk_in: "Walk in",
  other: "Other",
};

export function formatOpportunitySourceLabel(source: string) {
  if ((OPPORTUNITY_SOURCES as readonly string[]).includes(source)) {
    return OPPORTUNITY_SOURCE_LABELS[source as OpportunitySource];
  }

  return source
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getOpportunitySourceOptions() {
  return OPPORTUNITY_SOURCES.map((source) => ({
    value: source,
    label: OPPORTUNITY_SOURCE_LABELS[source],
  }));
}
