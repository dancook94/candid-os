import {
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/crm/types";

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  new_enquiry: "New Enquiry",
  qualifying: "Qualifying",
  quote_in_progress: "Quote in Progress",
  quote_sent: "Quote Sent",
  follow_up: "Follow Up",
  won: "Won",
  lost: "Lost",
};

export const OPPORTUNITY_STAGE_ORDER: Record<OpportunityStage, number> = {
  new_enquiry: 10,
  qualifying: 20,
  quote_in_progress: 30,
  quote_sent: 40,
  follow_up: 50,
  won: 60,
  lost: 70,
};

export const TERMINAL_OPPORTUNITY_STAGES: OpportunityStage[] = ["won", "lost"];

export const ACTIVE_PIPELINE_STAGES = OPPORTUNITY_STAGES.filter(
  (stage) => !TERMINAL_OPPORTUNITY_STAGES.includes(stage)
);

export function isOpportunityStage(value: string): value is OpportunityStage {
  return (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

export function formatOpportunityStageLabel(stage: string) {
  if (isOpportunityStage(stage)) {
    return OPPORTUNITY_STAGE_LABELS[stage];
  }

  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function compareOpportunityStages(
  left: OpportunityStage,
  right: OpportunityStage
) {
  return OPPORTUNITY_STAGE_ORDER[left] - OPPORTUNITY_STAGE_ORDER[right];
}

export function isTerminalOpportunityStage(stage: OpportunityStage) {
  return TERMINAL_OPPORTUNITY_STAGES.includes(stage);
}

export function getOpportunityStageOptions() {
  return OPPORTUNITY_STAGES.map((stage) => ({
    value: stage,
    label: OPPORTUNITY_STAGE_LABELS[stage],
    isTerminal: isTerminalOpportunityStage(stage),
  }));
}
