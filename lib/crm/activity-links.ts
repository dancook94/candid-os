export const CRM_ACTIVITY_ACTOR_PROFILE_ID_FKEY =
  "crm_activity_actor_profile_id_fkey";

export type ActivityRecordType =
  | "quote"
  | "opportunity"
  | "task"
  | "contact"
  | "company";

export type ActivityLinkLabels = {
  companyNameById: Map<string, string>;
  contactNameById: Map<string, string>;
  opportunityTitleById: Map<string, string>;
  quoteLabelById: Map<string, string>;
  taskTitleById: Map<string, string>;
};

export type ActivityLinkedRecord = {
  type: ActivityRecordType;
  id: string;
  label: string;
  href: string;
};

type ActivityLinkRow = {
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  task_id: string | null;
};

const RECORD_TYPE_LABELS: Record<ActivityRecordType, string> = {
  quote: "Quote",
  opportunity: "Opportunity",
  task: "Task",
  contact: "Contact",
  company: "Company",
};

export function formatActivityRecordTypeLabel(type: ActivityRecordType) {
  return RECORD_TYPE_LABELS[type];
}

export function resolveActivityRecordType(
  row: ActivityLinkRow
): ActivityRecordType | null {
  if (row.quote_id) {
    return "quote";
  }

  if (row.opportunity_id) {
    return "opportunity";
  }

  if (row.task_id) {
    return "task";
  }

  if (row.contact_id) {
    return "contact";
  }

  if (row.company_id) {
    return "company";
  }

  return null;
}

function buildRecordLink(
  type: ActivityRecordType,
  id: string,
  labels: ActivityLinkLabels
): ActivityLinkedRecord | null {
  switch (type) {
    case "quote":
      return {
        type,
        id,
        label: labels.quoteLabelById.get(id) ?? "Quote",
        href: `/admin/quotes/${id}`,
      };
    case "opportunity":
      return {
        type,
        id,
        label: labels.opportunityTitleById.get(id) ?? "Opportunity",
        href: `/admin/opportunities/${id}`,
      };
    case "task":
      return {
        type,
        id,
        label: labels.taskTitleById.get(id) ?? "Task",
        href: `/admin/tasks/${id}/edit`,
      };
    case "contact":
      return {
        type,
        id,
        label: labels.contactNameById.get(id) ?? "Contact",
        href: `/admin/customers/${id}`,
      };
    case "company":
      return {
        type,
        id,
        label: labels.companyNameById.get(id) ?? "Company",
        href: `/admin/companies/${id}`,
      };
  }
}

export function pickActivityPrimaryLink(
  row: ActivityLinkRow,
  labels: ActivityLinkLabels
) {
  const recordType = resolveActivityRecordType(row);

  if (!recordType) {
    return {
      recordType: null,
      primaryLink: null,
      secondaryLinks: [] as ActivityLinkedRecord[],
    };
  }

  const primaryId =
    recordType === "quote"
      ? row.quote_id
      : recordType === "opportunity"
        ? row.opportunity_id
        : recordType === "task"
          ? row.task_id
          : recordType === "contact"
            ? row.contact_id
            : row.company_id;

  if (!primaryId) {
    return {
      recordType: null,
      primaryLink: null,
      secondaryLinks: [] as ActivityLinkedRecord[],
    };
  }

  const primaryLink = buildRecordLink(recordType, primaryId, labels);
  const secondaryLinks: ActivityLinkedRecord[] = [];

  const candidates: Array<[ActivityRecordType, string | null]> = [
    ["quote", row.quote_id],
    ["opportunity", row.opportunity_id],
    ["task", row.task_id],
    ["contact", row.contact_id],
    ["company", row.company_id],
  ];

  for (const [type, id] of candidates) {
    if (!id || (primaryLink && type === primaryLink.type && id === primaryLink.id)) {
      continue;
    }

    const link = buildRecordLink(type, id, labels);
    if (link) {
      secondaryLinks.push(link);
    }
  }

  return {
    recordType,
    primaryLink,
    secondaryLinks,
  };
}
