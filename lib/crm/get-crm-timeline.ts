import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  formatCrmNoteTypeLabel,
  isCrmNoteType,
  type CrmNoteType,
} from "@/lib/crm/crm-note-types";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import type { CrmTimelineCategory } from "@/lib/crm/activity-types";
import { categorizeCrmActivityType } from "@/lib/crm/activity-types";

export type CrmNoteRecord = {
  id: string;
  body: string;
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  task_id: string | null;
  created_by: string;
  is_pinned: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmActivityRecord = {
  id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown>;
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  task_id: string | null;
  actor_profile_id: string | null;
  created_at: string;
};

export type CrmNoteListItem = CrmNoteRecord & {
  note_type: CrmNoteType;
  author_name: string;
  author_avatar_url: string | null;
  linked_record_label: string | null;
  linked_record_href: string | null;
  can_edit: boolean;
  can_delete: boolean;
};

export type CrmTimelineItem = {
  id: string;
  source: "activity" | "note";
  category: Exclude<CrmTimelineCategory, "all">;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown>;
  actor_name: string | null;
  actor_avatar_url: string | null;
  created_at: string;
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  task_id: string | null;
  linked_record_label: string | null;
  linked_record_href: string | null;
};

export type CrmTimelineScope =
  | { type: "company"; companyId: string }
  | { type: "contact"; contactId: string; companyId: string }
  | {
      type: "opportunity";
      opportunityId: string;
      companyId: string;
      contactId?: string | null;
    }
  | {
      type: "quote";
      quoteId: string;
      companyId: string;
      opportunityId?: string | null;
      contactId?: string | null;
    }
  | {
      type: "task";
      taskId: string;
      companyId?: string | null;
      opportunityId?: string | null;
      quoteId?: string | null;
    }
  | { type: "recent"; limit?: number };

export type CrmTimelineDateFilter = "today" | "7d" | "30d" | "all";

export type GetCrmTimelineOptions = {
  scope: CrmTimelineScope;
  category?: CrmTimelineCategory;
  dateFilter?: CrmTimelineDateFilter;
  limit?: number;
  offset?: number;
  includeNotesAsTimeline?: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
};

const DEFAULT_LIMIT = 25;

function getDateCutoff(dateFilter: CrmTimelineDateFilter | undefined) {
  if (!dateFilter || dateFilter === "all") {
    return null;
  }

  const now = new Date();

  if (dateFilter === "today") {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  const days = dateFilter === "7d" ? 7 : 30;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

function resolveNoteTypeFromActivities(
  noteId: string,
  activities: CrmActivityRecord[]
): CrmNoteType {
  const noteActivities = activities
    .filter((entry) => {
      const metadataNoteId = entry.metadata?.note_id;
      return metadataNoteId === noteId;
    })
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );

  for (const entry of noteActivities) {
    const noteType = entry.metadata?.note_type;
    if (typeof noteType === "string" && isCrmNoteType(noteType)) {
      return noteType;
    }
  }

  return "note";
}

async function loadActorProfiles(
  supabase: SupabaseClient,
  profileIds: string[]
) {
  if (profileIds.length === 0) {
    return new Map<string, { name: string; avatar_url: string | null }>();
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", profileIds);

  return new Map(
    (data ?? []).map((profile) => [
      profile.id,
      {
        name: getStaffDisplayName(profile),
        avatar_url: null,
      },
    ])
  );
}

async function buildLinkedRecordLabels(
  supabase: SupabaseClient,
  notes: CrmNoteRecord[],
  activities: CrmActivityRecord[]
) {
  const companyIds = new Set<string>();
  const contactIds = new Set<string>();
  const opportunityIds = new Set<string>();
  const quoteIds = new Set<string>();
  const taskIds = new Set<string>();

  for (const row of [...notes, ...activities]) {
    if (row.company_id) companyIds.add(row.company_id);
    if ("contact_id" in row && row.contact_id) contactIds.add(row.contact_id);
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
      ? supabase.from("opportunities").select("id, title").in("id", [...opportunityIds])
      : Promise.resolve({ data: [] }),
    quoteIds.size
      ? supabase.from("quotes").select("id, quote_number, project_name").in("id", [...quoteIds])
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

function pickPrimaryLink(
  row: {
    company_id: string | null;
    contact_id: string | null;
    opportunity_id: string | null;
    quote_id: string | null;
    task_id: string | null;
  },
  labels: Awaited<ReturnType<typeof buildLinkedRecordLabels>>
) {
  if (row.task_id) {
    return {
      label: labels.taskTitleById.get(row.task_id) ?? "Task",
      href: `/admin/tasks/${row.task_id}/edit`,
    };
  }

  if (row.quote_id) {
    return {
      label: labels.quoteLabelById.get(row.quote_id) ?? "Quote",
      href: `/admin/quotes/${row.quote_id}`,
    };
  }

  if (row.opportunity_id) {
    return {
      label: labels.opportunityTitleById.get(row.opportunity_id) ?? "Opportunity",
      href: `/admin/opportunities/${row.opportunity_id}`,
    };
  }

  if (row.contact_id) {
    return {
      label: labels.contactNameById.get(row.contact_id) ?? "Contact",
      href: `/admin/customers/${row.contact_id}`,
    };
  }

  if (row.company_id) {
    return {
      label: labels.companyNameById.get(row.company_id) ?? "Company",
      href: `/admin/companies/${row.company_id}`,
    };
  }

  return { label: null, href: null };
}

async function resolveScopeIds(
  supabase: SupabaseClient,
  scope: CrmTimelineScope
) {
  switch (scope.type) {
    case "company": {
      const companyId = scope.companyId;
      const [{ data: contacts }, { data: opportunities }, { data: quotes }, { data: tasks }] =
        await Promise.all([
          supabase.from("contacts").select("id").eq("company_id", companyId),
          supabase.from("opportunities").select("id").eq("company_id", companyId),
          supabase.from("quotes").select("id").eq("company_id", companyId),
          supabase.from("tasks").select("id").eq("company_id", companyId),
        ]);

      return {
        companyIds: [companyId],
        contactIds: (contacts ?? []).map((row) => row.id),
        opportunityIds: (opportunities ?? []).map((row) => row.id),
        quoteIds: (quotes ?? []).map((row) => row.id),
        taskIds: (tasks ?? []).map((row) => row.id),
      };
    }
    case "contact":
      return {
        companyIds: [scope.companyId],
        contactIds: [scope.contactId],
        opportunityIds: [] as string[],
        quoteIds: [] as string[],
        taskIds: [] as string[],
      };
    case "opportunity":
      return {
        companyIds: [scope.companyId],
        contactIds: scope.contactId ? [scope.contactId] : [],
        opportunityIds: [scope.opportunityId],
        quoteIds: [] as string[],
        taskIds: [] as string[],
      };
    case "quote":
      return {
        companyIds: [scope.companyId],
        contactIds: scope.contactId ? [scope.contactId] : [],
        opportunityIds: scope.opportunityId ? [scope.opportunityId] : [],
        quoteIds: [scope.quoteId],
        taskIds: [] as string[],
      };
    case "task":
      return {
        companyIds: scope.companyId ? [scope.companyId] : [],
        contactIds: [] as string[],
        opportunityIds: scope.opportunityId ? [scope.opportunityId] : [],
        quoteIds: scope.quoteId ? [scope.quoteId] : [],
        taskIds: [scope.taskId],
      };
    case "recent":
      return {
        companyIds: [] as string[],
        contactIds: [] as string[],
        opportunityIds: [] as string[],
        quoteIds: [] as string[],
        taskIds: [] as string[],
      };
  }
}

function buildOrFilter(
  ids: Awaited<ReturnType<typeof resolveScopeIds>>
) {
  const parts: string[] = [];

  if (ids.companyIds.length === 1) {
    parts.push(`company_id.eq.${ids.companyIds[0]}`);
  }

  if (ids.contactIds.length > 0) {
    parts.push(`contact_id.in.(${ids.contactIds.join(",")})`);
  }

  if (ids.opportunityIds.length > 0) {
    parts.push(`opportunity_id.in.(${ids.opportunityIds.join(",")})`);
  }

  if (ids.quoteIds.length > 0) {
    parts.push(`quote_id.in.(${ids.quoteIds.join(",")})`);
  }

  if (ids.taskIds.length > 0) {
    parts.push(`task_id.in.(${ids.taskIds.join(",")})`);
  }

  return parts.join(",");
}

export async function getCrmNotes(
  supabase: SupabaseClient,
  options: GetCrmTimelineOptions
): Promise<CrmNoteListItem[]> {
  const scopeIds = await resolveScopeIds(supabase, options.scope);
  const orFilter = buildOrFilter(scopeIds);

  let notesQuery = supabase
    .from("crm_notes")
    .select("*")
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (options.scope.type === "recent") {
    notesQuery = notesQuery.limit(options.limit ?? 10);
  } else if (orFilter) {
    notesQuery = notesQuery.or(orFilter);
  } else {
    return [];
  }

  const { data: noteRows, error } = await notesQuery;

  if (error) {
    throw new Error(error.message);
  }

  const notes = (noteRows ?? []) as CrmNoteRecord[];

  if (notes.length === 0 && options.scope.type === "opportunity") {
    const { data: legacyNotes } = await supabase
      .from("opportunity_notes")
      .select("*")
      .eq("opportunity_id", options.scope.opportunityId)
      .order("created_at", { ascending: false });

    const { data: migratedSources } = await supabase
      .from("crm_notes")
      .select("source_opportunity_note_id")
      .not("source_opportunity_note_id", "is", null);

    const migratedIds = new Set(
      (migratedSources ?? [])
        .map((row) => row.source_opportunity_note_id)
        .filter((value): value is string => Boolean(value))
    );

    for (const legacy of legacyNotes ?? []) {
      if (migratedIds.has(legacy.id)) {
        continue;
      }

      notes.push({
        id: legacy.id,
        body: legacy.body,
        company_id: options.scope.companyId,
        contact_id: options.scope.contactId ?? null,
        opportunity_id: legacy.opportunity_id,
        quote_id: null,
        task_id: null,
        created_by: legacy.created_by,
        is_pinned: false,
        deleted_at: null,
        created_at: legacy.created_at,
        updated_at: legacy.updated_at,
      });
    }
  }

  if (notes.length === 0) {
    return [];
  }

  const noteIds = notes.map((note) => note.id);
  const noteActivityFilter = noteIds
    .map((noteId) => `metadata->>note_id.eq.${noteId}`)
    .join(",");
  const { data: noteActivities } = await supabase
    .from("crm_activity")
    .select("*")
    .in("activity_type", [
      CRM_ACTIVITY_TYPES.noteAdded,
      CRM_ACTIVITY_TYPES.noteEdited,
    ])
    .or(noteActivityFilter);

  const activities = (noteActivities ?? []) as CrmActivityRecord[];
  const authorIds = [...new Set(notes.map((note) => note.created_by))];
  const actorProfiles = await loadActorProfiles(supabase, authorIds);
  const labels = await buildLinkedRecordLabels(supabase, notes, activities);

  return notes.map((note) => {
    const author = actorProfiles.get(note.created_by);
    const link = pickPrimaryLink(note, labels);
    const canManage =
      options.isAdmin || options.currentUserId === note.created_by;

    return {
      ...note,
      note_type: resolveNoteTypeFromActivities(note.id, activities),
      author_name: author?.name ?? "Unknown author",
      author_avatar_url: author?.avatar_url ?? null,
      linked_record_label: link.label,
      linked_record_href: link.href,
      can_edit: Boolean(canManage),
      can_delete: Boolean(canManage),
    };
  });
}

export async function getCrmTimeline(
  supabase: SupabaseClient,
  options: GetCrmTimelineOptions
): Promise<{ items: CrmTimelineItem[]; hasMore: boolean }> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  const dateCutoff = getDateCutoff(options.dateFilter);

  let activityQuery = supabase
    .from("crm_activity")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (dateCutoff) {
    activityQuery = activityQuery.gte("created_at", dateCutoff);
  }

  if (options.scope.type === "recent") {
    activityQuery = supabase
      .from("crm_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(options.scope.limit ?? 10);
  } else {
    const scopeIds = await resolveScopeIds(supabase, options.scope);
    const orFilter = buildOrFilter(scopeIds);

    if (!orFilter) {
      return { items: [], hasMore: false };
    }

    activityQuery = activityQuery.or(orFilter);
  }

  const { data: activityRows, error } = await activityQuery;

  if (error) {
    throw new Error(error.message);
  }

  let activities = (activityRows ?? []) as CrmActivityRecord[];

  if (
    activities.length === 0 &&
    options.scope.type === "opportunity"
  ) {
    const { data: legacyActivity } = await supabase
      .from("opportunity_activity")
      .select("*")
      .eq("opportunity_id", options.scope.opportunityId)
      .order("created_at", { ascending: false })
      .limit(limit);

    const { data: migratedSources } = await supabase
      .from("crm_activity")
      .select("source_opportunity_activity_id")
      .not("source_opportunity_activity_id", "is", null);

    const migratedIds = new Set(
      (migratedSources ?? [])
        .map((row) => row.source_opportunity_activity_id)
        .filter((value): value is string => Boolean(value))
    );

    activities = (legacyActivity ?? [])
      .filter((entry) => !migratedIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        activity_type: entry.activity_type,
        description: entry.description,
        metadata: (entry.metadata ?? {}) as Record<string, unknown>,
        company_id:
          options.scope.type === "opportunity" ? options.scope.companyId : null,
        contact_id:
          options.scope.type === "opportunity"
            ? options.scope.contactId ?? null
            : null,
        opportunity_id: entry.opportunity_id,
        quote_id: null,
        task_id: null,
        actor_profile_id: entry.created_by,
        created_at: entry.created_at,
      }));
  }

  if (options.category && options.category !== "all") {
    activities = activities.filter(
      (entry) => categorizeCrmActivityType(entry.activity_type) === options.category
    );
  }

  const actorIds = [
    ...new Set(
      activities
        .map((entry) => entry.actor_profile_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const actorProfiles = await loadActorProfiles(supabase, actorIds);
  const labels = await buildLinkedRecordLabels(supabase, [], activities);

  const items: CrmTimelineItem[] = activities.map((entry) => {
    const actor = entry.actor_profile_id
      ? actorProfiles.get(entry.actor_profile_id)
      : null;
    const link = pickPrimaryLink(entry, labels);

    return {
      id: entry.id,
      source: "activity",
      category: categorizeCrmActivityType(entry.activity_type),
      activity_type: entry.activity_type,
      description: entry.description,
      metadata: (entry.metadata ?? {}) as Record<string, unknown>,
      actor_name: actor?.name ?? null,
      actor_avatar_url: actor?.avatar_url ?? null,
      created_at: entry.created_at,
      company_id: entry.company_id,
      contact_id: entry.contact_id,
      opportunity_id: entry.opportunity_id,
      quote_id: entry.quote_id,
      task_id: entry.task_id,
      linked_record_label: link.label,
      linked_record_href: link.href,
    };
  });

  if (options.includeNotesAsTimeline) {
    const notes = await getCrmNotes(supabase, options);
    const noteItems: CrmTimelineItem[] = notes.map((note) => ({
      id: `note:${note.id}`,
      source: "note",
      category: "notes",
      activity_type: "note",
      description: note.body,
      metadata: { note_id: note.id, note_type: note.note_type },
      actor_name: note.author_name,
      actor_avatar_url: note.author_avatar_url,
      created_at: note.created_at,
      company_id: note.company_id,
      contact_id: note.contact_id,
      opportunity_id: note.opportunity_id,
      quote_id: note.quote_id,
      task_id: note.task_id,
      linked_record_label: note.linked_record_label,
      linked_record_href: note.linked_record_href,
    }));

    items.push(...noteItems);
    items.sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );
  }

  const hasMore = activities.length > limit;

  return {
    items: items.slice(0, limit),
    hasMore,
  };
}

export async function updateCrmNote(
  supabase: SupabaseClient,
  {
    noteId,
    body,
    noteType,
    isPinned,
    actorProfileId,
    isAdmin,
  }: {
    noteId: string;
    body?: string;
    noteType?: string;
    isPinned?: boolean;
    actorProfileId: string;
    isAdmin: boolean;
  }
) {
  const { data: existing, error: fetchError } = await supabase
    .from("crm_notes")
    .select("*")
    .eq("id", noteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!existing) {
    throw new Error("Note not found.");
  }

  if (!isAdmin && existing.created_by !== actorProfileId) {
    throw new Error("You do not have permission to edit this note.");
  }

  const updates: Record<string, unknown> = {};
  let bodyChanged = false;
  let pinChanged = false;

  if (body !== undefined) {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new Error("Note body is required.");
    }
    if (trimmed !== existing.body) {
      updates.body = trimmed;
      bodyChanged = true;
    }
  }

  if (noteType !== undefined && !isCrmNoteType(noteType)) {
    throw new Error("Invalid note type.");
  }

  if (isPinned !== undefined && isPinned !== existing.is_pinned) {
    updates.is_pinned = isPinned;
    pinChanged = true;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from("crm_notes")
      .update(updates)
      .eq("id", noteId);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  const links = {
    companyId: existing.company_id,
    contactId: existing.contact_id,
    opportunityId: existing.opportunity_id,
    quoteId: existing.quote_id,
    taskId: existing.task_id,
  };

  if (bodyChanged || (noteType !== undefined && isCrmNoteType(noteType))) {
    await createCrmActivity(supabase, {
      ...links,
      activityType: CRM_ACTIVITY_TYPES.noteEdited,
      description: "Note edited.",
      metadata: {
        note_id: noteId,
        note_type: noteType ?? "note",
      },
      actorProfileId,
    });
  }

  if (pinChanged) {
    await createCrmActivity(supabase, {
      ...links,
      activityType: isPinned
        ? CRM_ACTIVITY_TYPES.notePinned
        : CRM_ACTIVITY_TYPES.noteUnpinned,
      description: isPinned ? "Note pinned." : "Note unpinned.",
      metadata: { note_id: noteId },
      actorProfileId,
    });
  }
}

export async function softDeleteCrmNote(
  supabase: SupabaseClient,
  {
    noteId,
    actorProfileId,
    isAdmin,
  }: {
    noteId: string;
    actorProfileId: string;
    isAdmin: boolean;
  }
) {
  const { data: existing, error: fetchError } = await supabase
    .from("crm_notes")
    .select("*")
    .eq("id", noteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!existing) {
    throw new Error("Note not found.");
  }

  if (!isAdmin && existing.created_by !== actorProfileId) {
    throw new Error("You do not have permission to delete this note.");
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("crm_notes")
    .update({
      deleted_at: now,
      deleted_by: actorProfileId,
    })
    .eq("id", noteId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await createCrmActivity(supabase, {
    companyId: existing.company_id,
    contactId: existing.contact_id,
    opportunityId: existing.opportunity_id,
    quoteId: existing.quote_id,
    taskId: existing.task_id,
    activityType: CRM_ACTIVITY_TYPES.noteDeleted,
    description: "Note deleted.",
    metadata: { note_id: noteId },
    actorProfileId,
  });
}
