export const OPPORTUNITY_ACTIVITY_TYPES = {
  opportunityCreated: "opportunity_created",
  stageChanged: "stage_changed",
  ownerChanged: "owner_changed",
  collaboratorsChanged: "collaborators_changed",
  collaboratorAdded: "collaborator_added",
  collaboratorRemoved: "collaborator_removed",
  estimatedValueChanged: "estimated_value_changed",
  taskCreated: "task_created",
  taskCompleted: "task_completed",
  taskReopened: "task_reopened",
  taskAssigneeAdded: "task_assignee_added",
  taskAssigneeRemoved: "task_assignee_removed",
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
