export const OPPORTUNITY_ACTIVITY_TYPES = {
  opportunityCreated: "opportunity_created",
  stageChanged: "stage_changed",
  ownerChanged: "owner_changed",
  collaboratorsChanged: "collaborators_changed",
  estimatedValueChanged: "estimated_value_changed",
  taskCreated: "task_created",
  taskCompleted: "task_completed",
  taskReopened: "task_reopened",
  noteAdded: "note_added",
  quoteCreated: "quote_created",
  quoteLinked: "quote_linked",
} as const;

export function formatActivityTypeLabel(activityType: string) {
  return activityType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
