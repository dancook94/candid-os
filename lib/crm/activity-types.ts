export const CRM_ACTIVITY_TYPES = {
  companyCreated: "company_created",
  companyUpdated: "company_updated",
  paymentTermsChanged: "payment_terms_changed",
  companyDeactivated: "company_deactivated",
  companyReactivated: "company_reactivated",
  contactCreated: "contact_created",
  contactUpdated: "contact_updated",
  contactSetPrimary: "contact_set_primary",
  contactDeactivated: "contact_deactivated",
  contactReactivated: "contact_reactivated",
  portalInvitationSent: "portal_invitation_sent",
  portalInvitationResent: "portal_invitation_resent",
  portalAccessApproved: "portal_access_approved",
  opportunityCreated: "opportunity_created",
  stageChanged: "stage_changed",
  ownerChanged: "owner_changed",
  collaboratorAdded: "collaborator_added",
  collaboratorRemoved: "collaborator_removed",
  contactChanged: "contact_changed",
  estimatedValueChanged: "estimated_value_changed",
  opportunityWon: "opportunity_won",
  opportunityLost: "opportunity_lost",
  opportunityDeleted: "opportunity_deleted",
  quoteCreated: "quote_created",
  quoteVersionCreated: "quote_version_created",
  quoteSent: "quote_sent",
  quoteAccepted: "quote_accepted",
  quoteDeclined: "quote_declined",
  quoteLinked: "quote_linked",
  quoteDeleted: "quote_deleted",
  taskCreated: "task_created",
  taskUpdated: "task_updated",
  taskAssigneeAdded: "task_assignee_added",
  taskAssigneeRemoved: "task_assignee_removed",
  taskCompleted: "task_completed",
  taskReopened: "task_reopened",
  taskCancelled: "task_cancelled",
  taskDeleted: "task_deleted",
  noteAdded: "note_added",
  noteEdited: "note_edited",
  notePinned: "note_pinned",
  noteUnpinned: "note_unpinned",
  noteDeleted: "note_deleted",
} as const;

/** @deprecated Use CRM_ACTIVITY_TYPES */
export const OPPORTUNITY_ACTIVITY_TYPES = CRM_ACTIVITY_TYPES;

const PORTAL_ACTIVITY_TYPES = new Set<string>([
  CRM_ACTIVITY_TYPES.portalInvitationSent,
  CRM_ACTIVITY_TYPES.portalInvitationResent,
  CRM_ACTIVITY_TYPES.portalAccessApproved,
]);

const CONTACT_ACTIVITY_TYPES = new Set<string>([
  CRM_ACTIVITY_TYPES.contactCreated,
  CRM_ACTIVITY_TYPES.contactUpdated,
  CRM_ACTIVITY_TYPES.contactSetPrimary,
  CRM_ACTIVITY_TYPES.contactDeactivated,
  CRM_ACTIVITY_TYPES.contactReactivated,
  ...PORTAL_ACTIVITY_TYPES,
]);

export type CrmTimelineCategory =
  | "all"
  | "notes"
  | "contacts"
  | "opportunities"
  | "quotes"
  | "tasks"
  | "portal";

export function categorizeCrmActivityType(
  activityType: string
): Exclude<CrmTimelineCategory, "all"> {
  if (
    activityType === CRM_ACTIVITY_TYPES.noteAdded ||
    activityType === CRM_ACTIVITY_TYPES.noteEdited ||
    activityType === CRM_ACTIVITY_TYPES.notePinned ||
    activityType === CRM_ACTIVITY_TYPES.noteUnpinned ||
    activityType === CRM_ACTIVITY_TYPES.noteDeleted
  ) {
    return "notes";
  }

  if (PORTAL_ACTIVITY_TYPES.has(activityType)) {
    return "portal";
  }

  if (CONTACT_ACTIVITY_TYPES.has(activityType)) {
    return "contacts";
  }

  if (activityType.startsWith("task_")) {
    return "tasks";
  }

  if (activityType.startsWith("quote_")) {
    return "quotes";
  }

  if (
    activityType.startsWith("company_") ||
    activityType === CRM_ACTIVITY_TYPES.paymentTermsChanged
  ) {
    return "contacts";
  }

  return "opportunities";
}

export function formatActivityTypeLabel(activityType: string) {
  return activityType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
