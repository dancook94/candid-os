import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatActivityRecordTypeLabel,
  pickActivityPrimaryLink,
  resolveActivityRecordType,
  type ActivityRecordType,
} from "@/lib/crm/activity-links";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { formatActivityTypeLabel } from "@/lib/crm/activity-types";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import {
  getLondonDateRangeBounds,
  getLondonDayBounds,
  getLondonMonthBounds,
} from "@/lib/crm/day-bounds";
import { CRM_ROLES } from "@/lib/staff-roles";

export const ACTIVITY_LIST_PAGE_SIZE = 50;

export const ACTIVITY_LIST_GROUP_OPTIONS = [
  "all",
  "companies",
  "contacts",
  "opportunities",
  "quotes",
  "tasks",
  "notes",
  "portal",
] as const;

export type ActivityListGroup = (typeof ACTIVITY_LIST_GROUP_OPTIONS)[number];

export const ACTIVITY_LIST_RECORD_OPTIONS = [
  "all",
  "company",
  "contact",
  "opportunity",
  "quote",
  "task",
] as const;

export type ActivityListRecordFilter =
  (typeof ACTIVITY_LIST_RECORD_OPTIONS)[number];

export const ACTIVITY_LIST_DATE_OPTIONS = [
  "all",
  "today",
  "7d",
  "30d",
  "month",
  "custom",
] as const;

export type ActivityListDateFilter =
  (typeof ACTIVITY_LIST_DATE_OPTIONS)[number];

export const ACTIVITY_LIST_SORT_OPTIONS = ["newest", "oldest"] as const;

export type ActivityListSort = (typeof ACTIVITY_LIST_SORT_OPTIONS)[number];

export const ACTIVITY_TYPE_GROUPS: Record<
  Exclude<ActivityListGroup, "all">,
  string[]
> = {
  companies: [
    CRM_ACTIVITY_TYPES.companyCreated,
    CRM_ACTIVITY_TYPES.companyUpdated,
    CRM_ACTIVITY_TYPES.paymentTermsChanged,
    CRM_ACTIVITY_TYPES.companyDeactivated,
    CRM_ACTIVITY_TYPES.companyReactivated,
  ],
  contacts: [
    CRM_ACTIVITY_TYPES.contactCreated,
    CRM_ACTIVITY_TYPES.contactUpdated,
    CRM_ACTIVITY_TYPES.contactSetPrimary,
    CRM_ACTIVITY_TYPES.contactDeactivated,
    CRM_ACTIVITY_TYPES.contactReactivated,
  ],
  portal: [
    CRM_ACTIVITY_TYPES.portalInvitationSent,
    CRM_ACTIVITY_TYPES.portalInvitationResent,
    CRM_ACTIVITY_TYPES.portalAccessApproved,
  ],
  opportunities: [
    CRM_ACTIVITY_TYPES.opportunityCreated,
    CRM_ACTIVITY_TYPES.stageChanged,
    CRM_ACTIVITY_TYPES.ownerChanged,
    CRM_ACTIVITY_TYPES.collaboratorAdded,
    CRM_ACTIVITY_TYPES.collaboratorRemoved,
    CRM_ACTIVITY_TYPES.contactChanged,
    CRM_ACTIVITY_TYPES.estimatedValueChanged,
    CRM_ACTIVITY_TYPES.opportunityWon,
    CRM_ACTIVITY_TYPES.opportunityLost,
  ],
  quotes: [
    CRM_ACTIVITY_TYPES.quoteCreated,
    CRM_ACTIVITY_TYPES.quoteVersionCreated,
    CRM_ACTIVITY_TYPES.quoteSent,
    CRM_ACTIVITY_TYPES.quoteAccepted,
    CRM_ACTIVITY_TYPES.quoteDeclined,
    CRM_ACTIVITY_TYPES.quoteLinked,
    CRM_ACTIVITY_TYPES.quoteDeleted,
  ],
  tasks: [
    CRM_ACTIVITY_TYPES.taskCreated,
    CRM_ACTIVITY_TYPES.taskUpdated,
    CRM_ACTIVITY_TYPES.taskAssigneeAdded,
    CRM_ACTIVITY_TYPES.taskAssigneeRemoved,
    CRM_ACTIVITY_TYPES.taskCompleted,
    CRM_ACTIVITY_TYPES.taskReopened,
    CRM_ACTIVITY_TYPES.taskCancelled,
  ],
  notes: [
    CRM_ACTIVITY_TYPES.noteAdded,
    CRM_ACTIVITY_TYPES.noteEdited,
    CRM_ACTIVITY_TYPES.notePinned,
    CRM_ACTIVITY_TYPES.noteUnpinned,
    CRM_ACTIVITY_TYPES.noteDeleted,
  ],
};

export type ActivityListSearchParams = {
  search?: string;
  user?: string;
  group?: string;
  record?: string;
  company?: string;
  date?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: string;
};

export type ActivityListFilters = {
  search: string;
  userId: string | null;
  systemOnly: boolean;
  group: ActivityListGroup;
  record: ActivityListRecordFilter;
  companyId: string | null;
  date: ActivityListDateFilter;
  fromDate: string | null;
  toDate: string | null;
  sort: ActivityListSort;
  page: number;
};

export type ActivityListItem = {
  id: string;
  activity_type: string;
  activity_type_label: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_profile_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  company_id: string | null;
  company_name: string | null;
  record_type: ActivityRecordType | null;
  record_type_label: string | null;
  primary_link_label: string | null;
  primary_link_href: string | null;
  secondary_links: Array<{
    type: ActivityRecordType;
    label: string;
    href: string;
  }>;
};

export type ActivityListResult = {
  items: ActivityListItem[];
  totalCount: number;
  hasMore: boolean;
  queryError: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SYSTEM_USER_VALUE = "system";

type ActivityRow = {
  id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  task_id: string | null;
  actor_profile_id: string | null;
  created_at: string;
};

async function loadActivityActors(
  supabase: SupabaseClient,
  profileIds: string[]
) {
  if (profileIds.length === 0) {
    return new Map<
      string,
      { name: string; role: string | null }
    >();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, user_role")
    .in("id", profileIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    (data ?? []).map((profile) => [
      profile.id,
      {
        name: getStaffDisplayName(profile),
        role: profile.user_role ?? null,
      },
    ])
  );
}

function parseGroupParam(value: string | undefined): ActivityListGroup {
  if (
    value &&
    (ACTIVITY_LIST_GROUP_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as ActivityListGroup;
  }

  return "all";
}

function parseRecordParam(value: string | undefined): ActivityListRecordFilter {
  if (
    value &&
    (ACTIVITY_LIST_RECORD_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as ActivityListRecordFilter;
  }

  return "all";
}

function parseDateParam(value: string | undefined): ActivityListDateFilter {
  if (
    value &&
    (ACTIVITY_LIST_DATE_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as ActivityListDateFilter;
  }

  return "all";
}

function parseSortParam(value: string | undefined): ActivityListSort {
  if (
    value &&
    (ACTIVITY_LIST_SORT_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as ActivityListSort;
  }

  return "newest";
}

function parseDateInput(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) {
    return null;
  }

  return value;
}

function parsePageParam(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseUserParam(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return { userId: null, systemOnly: false };
  }

  if (trimmed === SYSTEM_USER_VALUE) {
    return { userId: null, systemOnly: true };
  }

  return { userId: trimmed, systemOnly: false };
}

export function parseActivityListFilters(
  params: ActivityListSearchParams
): ActivityListFilters {
  const user = parseUserParam(params.user);

  return {
    search: params.search?.trim() ?? "",
    userId: user.userId,
    systemOnly: user.systemOnly,
    group: parseGroupParam(params.group),
    record: parseRecordParam(params.record),
    companyId: params.company?.trim() || null,
    date: parseDateParam(params.date),
    fromDate: parseDateInput(params.from),
    toDate: parseDateInput(params.to),
    sort: parseSortParam(params.sort),
    page: parsePageParam(params.page),
  };
}

export function hasActiveActivityListFilters(filters: ActivityListFilters) {
  return Boolean(
    filters.search ||
      filters.userId ||
      filters.systemOnly ||
      filters.group !== "all" ||
      filters.record !== "all" ||
      filters.companyId ||
      filters.date !== "all" ||
      filters.fromDate ||
      filters.toDate ||
      filters.sort !== "newest" ||
      filters.page > 1
  );
}

export function buildActivityListHref(
  filters: ActivityListFilters,
  overrides: Partial<ActivityListFilters> = {}
) {
  const nextFilters = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (nextFilters.search) {
    params.set("search", nextFilters.search);
  }

  if (nextFilters.systemOnly) {
    params.set("user", SYSTEM_USER_VALUE);
  } else if (nextFilters.userId) {
    params.set("user", nextFilters.userId);
  }

  if (nextFilters.group !== "all") {
    params.set("group", nextFilters.group);
  }

  if (nextFilters.record !== "all") {
    params.set("record", nextFilters.record);
  }

  if (nextFilters.companyId) {
    params.set("company", nextFilters.companyId);
  }

  if (nextFilters.date !== "all") {
    params.set("date", nextFilters.date);
  }

  if (nextFilters.fromDate) {
    params.set("from", nextFilters.fromDate);
  }

  if (nextFilters.toDate) {
    params.set("to", nextFilters.toDate);
  }

  if (nextFilters.sort !== "newest") {
    params.set("sort", nextFilters.sort);
  }

  if (nextFilters.page > 1) {
    params.set("page", String(nextFilters.page));
  }

  const query = params.toString();
  return query ? `/admin/activity?${query}` : "/admin/activity";
}

function sanitizeIlikeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

function getDateBounds(filters: ActivityListFilters) {
  if (filters.fromDate && filters.toDate) {
    return getLondonDateRangeBounds(filters.fromDate, filters.toDate);
  }

  if (filters.date === "all") {
    return null;
  }

  if (filters.date === "today") {
    const { start, end } = getLondonDayBounds();
    return { start, end };
  }

  if (filters.date === "7d") {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return { start, end };
  }

  if (filters.date === "30d") {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return { start, end };
  }

  if (filters.date === "month") {
    return getLondonMonthBounds();
  }

  if (filters.date === "custom") {
    return null;
  }

  return null;
}

function applyRecordTypeFilter<T extends {
  eq: (column: string, value: unknown) => T;
  not: (column: string, operator: string, value: unknown) => T;
  is: (column: string, value: null) => T;
}>(query: T, record: ActivityListRecordFilter) {
  switch (record) {
    case "opportunity":
      return query.not("opportunity_id", "is", null);
    case "quote":
      return query.not("quote_id", "is", null).is("opportunity_id", null);
    case "task":
      return query
        .not("task_id", "is", null)
        .is("opportunity_id", null)
        .is("quote_id", null);
    case "contact":
      return query
        .not("contact_id", "is", null)
        .is("opportunity_id", null)
        .is("quote_id", null)
        .is("task_id", null);
    case "company":
      return query
        .not("company_id", "is", null)
        .is("opportunity_id", null)
        .is("quote_id", null)
        .is("task_id", null)
        .is("contact_id", null);
    default:
      return query;
  }
}

async function buildSearchOrFilter(
  supabase: SupabaseClient,
  search: string
) {
  const term = sanitizeIlikeTerm(search);

  if (!term) {
    return null;
  }

  const pattern = `%${term}%`;
  const parts = [
    `description.ilike.${pattern}`,
    `activity_type.ilike.${pattern}`,
  ];

  const [
    { data: actors },
    { data: companies },
    { data: contacts },
    { data: opportunities },
    { data: quotes },
    { data: tasks },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .ilike("full_name", pattern)
      .in("user_role", [...CRM_ROLES]),
    supabase.from("companies").select("id").ilike("company_name", pattern),
    supabase.from("contacts").select("id").ilike("full_name", pattern),
    supabase.from("opportunities").select("id").ilike("title", pattern),
    supabase
      .from("quotes")
      .select("id")
      .or(`project_name.ilike.${pattern},quote_number.ilike.${pattern}`),
    supabase.from("tasks").select("id").ilike("title", pattern),
  ]);

  const actorIds = (actors ?? []).map((row) => row.id);
  if (actorIds.length > 0) {
    parts.push(`actor_profile_id.in.(${actorIds.join(",")})`);
  }

  const companyIds = (companies ?? []).map((row) => row.id);
  if (companyIds.length > 0) {
    parts.push(`company_id.in.(${companyIds.join(",")})`);
  }

  const contactIds = (contacts ?? []).map((row) => row.id);
  if (contactIds.length > 0) {
    parts.push(`contact_id.in.(${contactIds.join(",")})`);
  }

  const opportunityIds = (opportunities ?? []).map((row) => row.id);
  if (opportunityIds.length > 0) {
    parts.push(`opportunity_id.in.(${opportunityIds.join(",")})`);
  }

  const quoteIds = (quotes ?? []).map((row) => row.id);
  if (quoteIds.length > 0) {
    parts.push(`quote_id.in.(${quoteIds.join(",")})`);
  }

  const taskIds = (tasks ?? []).map((row) => row.id);
  if (taskIds.length > 0) {
    parts.push(`task_id.in.(${taskIds.join(",")})`);
  }

  return parts.join(",");
}

async function buildLinkedRecordLabels(
  supabase: SupabaseClient,
  rows: ActivityRow[]
) {
  const companyIds = new Set<string>();
  const contactIds = new Set<string>();
  const opportunityIds = new Set<string>();
  const quoteIds = new Set<string>();
  const taskIds = new Set<string>();

  for (const row of rows) {
    if (row.company_id) companyIds.add(row.company_id);
    if (row.contact_id) contactIds.add(row.contact_id);
    if (row.opportunity_id) opportunityIds.add(row.opportunity_id);
    if (row.quote_id) quoteIds.add(row.quote_id);
    if (row.task_id) taskIds.add(row.task_id);
  }

  const [
    { data: companies },
    { data: contacts },
    { data: opportunities },
    { data: quotes },
    { data: tasks },
  ] = await Promise.all([
    companyIds.size
      ? supabase.from("companies").select("id, company_name").in("id", [...companyIds])
      : Promise.resolve({ data: [] }),
    contactIds.size
      ? supabase.from("contacts").select("id, full_name").in("id", [...contactIds])
      : Promise.resolve({ data: [] }),
    opportunityIds.size
      ? supabase
          .from("opportunities")
          .select("id, title")
          .in("id", [...opportunityIds])
      : Promise.resolve({ data: [] }),
    quoteIds.size
      ? supabase
          .from("quotes")
          .select("id, quote_number, project_name")
          .in("id", [...quoteIds])
      : Promise.resolve({ data: [] }),
    taskIds.size
      ? supabase.from("tasks").select("id, title").in("id", [...taskIds])
      : Promise.resolve({ data: [] }),
  ]);

  return {
    companyNameById: new Map(
      (companies ?? []).map((row) => [row.id, row.company_name])
    ),
    contactNameById: new Map(
      (contacts ?? []).map((row) => [row.id, row.full_name])
    ),
    opportunityTitleById: new Map(
      (opportunities ?? []).map((row) => [row.id, row.title])
    ),
    quoteLabelById: new Map(
      (quotes ?? []).map((row) => [
        row.id,
        `Q-${row.quote_number} · ${row.project_name}`,
      ])
    ),
    taskTitleById: new Map((tasks ?? []).map((row) => [row.id, row.title])),
  };
}

function mapActivityRows(
  rows: ActivityRow[],
  labels: Awaited<ReturnType<typeof buildLinkedRecordLabels>>,
  actors: Map<string, { name: string; role: string | null }>
): ActivityListItem[] {
  return rows.map((row) => {
    const { recordType, primaryLink, secondaryLinks } = pickActivityPrimaryLink(
      row,
      labels
    );
    const actor = row.actor_profile_id
      ? actors.get(row.actor_profile_id)
      : null;

    return {
      id: row.id,
      activity_type: row.activity_type,
      activity_type_label: formatActivityTypeLabel(row.activity_type),
      description: row.description,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      created_at: row.created_at,
      actor_profile_id: row.actor_profile_id,
      actor_name: actor?.name ?? (row.actor_profile_id ? null : "System"),
      actor_role: actor?.role ?? null,
      company_id: row.company_id,
      company_name: row.company_id
        ? labels.companyNameById.get(row.company_id) ?? null
        : null,
      record_type: recordType,
      record_type_label: recordType
        ? formatActivityRecordTypeLabel(recordType)
        : null,
      primary_link_label: primaryLink?.label ?? null,
      primary_link_href: primaryLink?.href ?? null,
      secondary_links: secondaryLinks.map((link) => ({
        type: link.type,
        label: link.label,
        href: link.href,
      })),
    };
  });
}

export async function fetchActivityList(
  supabase: SupabaseClient,
  filters: ActivityListFilters
): Promise<ActivityListResult> {
  const offset = (filters.page - 1) * ACTIVITY_LIST_PAGE_SIZE;
  const dateBounds = getDateBounds(filters);
  const searchOrFilter = filters.search
    ? await buildSearchOrFilter(supabase, filters.search)
    : null;

  const actorSelect = `id, activity_type, description, metadata, company_id, contact_id, opportunity_id, quote_id, task_id, actor_profile_id, created_at`;

  let query = supabase
    .from("crm_activity")
    .select(actorSelect, { count: "exact" })
    .order("created_at", { ascending: filters.sort === "oldest" })
    .range(offset, offset + ACTIVITY_LIST_PAGE_SIZE - 1);

  if (filters.systemOnly) {
    query = query.is("actor_profile_id", null);
  } else if (filters.userId) {
    query = query.eq("actor_profile_id", filters.userId);
  }

  if (filters.group !== "all") {
    query = query.in("activity_type", ACTIVITY_TYPE_GROUPS[filters.group]);
  }

  query = applyRecordTypeFilter(query, filters.record);

  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }

  if (dateBounds) {
    query = query
      .gte("created_at", dateBounds.start)
      .lte("created_at", dateBounds.end);
  }

  if (searchOrFilter) {
    query = query.or(searchOrFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    return {
      items: [],
      totalCount: 0,
      hasMore: false,
      queryError: error.message,
    };
  }

  const rows = (data ?? []) as ActivityRow[];
  const actorIds = [
    ...new Set(
      rows
        .map((row) => row.actor_profile_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];

  let labels: Awaited<ReturnType<typeof buildLinkedRecordLabels>>;
  let actors: Map<string, { name: string; role: string | null }>;

  try {
    [labels, actors] = await Promise.all([
      buildLinkedRecordLabels(supabase, rows),
      loadActivityActors(supabase, actorIds),
    ]);
  } catch (enrichmentError) {
    return {
      items: [],
      totalCount: 0,
      hasMore: false,
      queryError:
        enrichmentError instanceof Error
          ? enrichmentError.message
          : "Unable to load activity details.",
    };
  }

  const totalCount = count ?? rows.length;
  const hasMore = offset + rows.length < totalCount;

  return {
    items: mapActivityRows(rows, labels, actors),
    totalCount,
    hasMore,
    queryError: null,
  };
}

export function formatActivityListGroupLabel(group: ActivityListGroup) {
  if (group === "all") {
    return "All activity";
  }

  return group.charAt(0).toUpperCase() + group.slice(1);
}

export function formatActivityListDateLabel(date: ActivityListDateFilter) {
  switch (date) {
    case "today":
      return "Today";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "month":
      return "This month";
    case "custom":
      return "Custom range";
    default:
      return "All time";
  }
}

export function formatActivityListRecordLabel(record: ActivityListRecordFilter) {
  switch (record) {
    case "company":
      return "Companies";
    case "contact":
      return "Contacts";
    case "opportunity":
      return "Opportunities";
    case "quote":
      return "Quotes";
    case "task":
      return "Tasks";
    default:
      return "All records";
  }
}

export function formatActivityListSortLabel(sort: ActivityListSort) {
  return sort === "oldest" ? "Oldest first" : "Newest first";
}

export function formatActivityCountLabel(count: number) {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "activity" : "activities"}`;
}

export { resolveActivityRecordType, SYSTEM_USER_VALUE };
