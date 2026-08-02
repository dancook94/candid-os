import { StatusBadge } from "@/components/status-badge";
import { formatOpportunityStageLabel } from "@/lib/crm/opportunity-stages";
import type { OpportunityStage } from "@/lib/crm/types";

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const stageVariantMap: Record<OpportunityStage, BadgeStatus> = {
  new_enquiry: "pending",
  qualifying: "pending",
  quote_in_progress: "draft",
  quote_sent: "sent",
  follow_up: "sent",
  won: "accepted",
  lost: "declined",
};

type OpportunityStageBadgeProps = {
  stage: OpportunityStage | string;
};

export function OpportunityStageBadge({ stage }: OpportunityStageBadgeProps) {
  const normalized = stage as OpportunityStage;
  const variant =
    stageVariantMap[normalized as OpportunityStage] ?? "pending";

  return (
    <StatusBadge
      status={variant}
      label={formatOpportunityStageLabel(stage)}
    />
  );
}
