import type { SupabaseClient } from "@supabase/supabase-js";

import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { validateCrmStaffProfileIds } from "@/lib/crm/validate-crm-staff-ids";

export type TaskAssigneeProfile = {
  id: string;
  full_name: string | null;
  user_role: string;
  avatar_storage_path: string | null;
};

export type TaskAssigneeRow = {
  task_id: string;
  profile_id: string;
  assigned_at: string;
  assigned_by: string | null;
};

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function staffNameById(
  profiles: { id: string; full_name: string | null }[],
  profileId: string
) {
  const profile = profiles.find((entry) => entry.id === profileId);
  return profile ? getStaffDisplayName(profile) : "Unnamed staff member";
}

export async function loadTaskAssigneeIds(
  supabase: SupabaseClient,
  taskId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("profile_id")
    .eq("task_id", taskId)
    .order("assigned_at", { ascending: true });

  if (error) {
    // Fall back to legacy single assignee when join table is unavailable.
    const { data: task } = await supabase
      .from("tasks")
      .select("assigned_to")
      .eq("id", taskId)
      .maybeSingle();

    return task?.assigned_to ? [task.assigned_to] : [];
  }

  const assigneeIds = (data ?? []).map((row) => row.profile_id);

  if (assigneeIds.length > 0) {
    return assigneeIds;
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("assigned_to")
    .eq("id", taskId)
    .maybeSingle();

  return task?.assigned_to ? [task.assigned_to] : [];
}

export async function loadTaskAssigneesByTaskIds(
  supabase: SupabaseClient,
  taskIds: string[]
): Promise<Map<string, TaskAssigneeProfile[]>> {
  const result = new Map<string, TaskAssigneeProfile[]>();

  if (taskIds.length === 0) {
    return result;
  }

  const { data: assigneeRows, error } = await supabase
    .from("task_assignees")
    .select("task_id, profile_id, assigned_at")
    .in("task_id", taskIds)
    .order("assigned_at", { ascending: true });

  let rows = assigneeRows ?? [];

  if (error || rows.length === 0) {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, assigned_to")
      .in("id", taskIds);

    rows = (tasks ?? []).map((task) => ({
      task_id: task.id,
      profile_id: task.assigned_to,
      assigned_at: new Date(0).toISOString(),
    }));
  }

  const profileIds = [...new Set(rows.map((row) => row.profile_id))];

  if (profileIds.length === 0) {
    return result;
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, user_role, avatar_storage_path")
    .in("id", profileIds);

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile as TaskAssigneeProfile])
  );

  rows.forEach((row) => {
    const profile = profileById.get(row.profile_id);

    if (!profile) {
      return;
    }

    const current = result.get(row.task_id) ?? [];
    current.push(profile);
    result.set(row.task_id, current);
  });

  return result;
}

export async function loadTaskIdsForAssignee(
  supabase: SupabaseClient,
  profileId: string
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("profile_id", profileId);

  if (error) {
    return null;
  }

  return [...new Set((data ?? []).map((row) => row.task_id))];
}

export async function syncTaskAssignees(
  supabase: SupabaseClient,
  {
    taskId,
    assigneeProfileIds,
    assignedBy,
    opportunityId,
    taskTitle,
  }: {
    taskId: string;
    assigneeProfileIds: string[];
    assignedBy: string;
    opportunityId: string | null;
    taskTitle: string;
  }
): Promise<{ ok: true; primaryAssigneeId: string } | { ok: false; message: string }> {
  const nextAssigneeIds = uniqueIds(assigneeProfileIds);

  if (nextAssigneeIds.length === 0) {
    return { ok: false, message: "At least one assignee is required." };
  }

  const staffValidation = await validateCrmStaffProfileIds(
    supabase,
    nextAssigneeIds
  );

  if (!staffValidation.ok) {
    return staffValidation;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("task_assignees")
    .select("profile_id")
    .eq("task_id", taskId);

  if (existingError) {
    return { ok: false, message: existingError.message };
  }

  const previousAssigneeIds = (existingRows ?? []).map((row) => row.profile_id);
  const toAdd = nextAssigneeIds.filter(
    (id) => !previousAssigneeIds.includes(id)
  );
  const toRemove = previousAssigneeIds.filter(
    (id) => !nextAssigneeIds.includes(id)
  );

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", taskId)
      .in("profile_id", toRemove);

    if (deleteError) {
      return { ok: false, message: deleteError.message };
    }
  }

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase
      .from("task_assignees")
      .insert(
        toAdd.map((profileId) => ({
          task_id: taskId,
          profile_id: profileId,
          assigned_by: assignedBy,
        }))
      );

    if (insertError) {
      return { ok: false, message: insertError.message };
    }
  }

  const primaryAssigneeId = nextAssigneeIds[0];

  const { error: taskUpdateError } = await supabase
    .from("tasks")
    .update({ assigned_to: primaryAssigneeId })
    .eq("id", taskId);

  if (taskUpdateError) {
    return { ok: false, message: taskUpdateError.message };
  }

  if (opportunityId) {
    for (const profileId of toAdd) {
      await logOpportunityActivity(supabase, {
        opportunityId,
        activityType: OPPORTUNITY_ACTIVITY_TYPES.taskAssigneeAdded,
        description: `${staffNameById(staffValidation.profiles, profileId)} assigned to task "${taskTitle}".`,
        metadata: {
          task_id: taskId,
          profile_id: profileId,
          profile_name: staffNameById(staffValidation.profiles, profileId),
        },
        createdBy: assignedBy,
      });
    }

    for (const profileId of toRemove) {
      await logOpportunityActivity(supabase, {
        opportunityId,
        activityType: OPPORTUNITY_ACTIVITY_TYPES.taskAssigneeRemoved,
        description: `${staffNameById(staffValidation.profiles, profileId)} unassigned from task "${taskTitle}".`,
        metadata: {
          task_id: taskId,
          profile_id: profileId,
          profile_name: staffNameById(staffValidation.profiles, profileId),
        },
        createdBy: assignedBy,
      });
    }
  }

  return { ok: true, primaryAssigneeId };
}

export async function createTaskAssignees(
  supabase: SupabaseClient,
  {
    taskId,
    assigneeProfileIds,
    assignedBy,
  }: {
    taskId: string;
    assigneeProfileIds: string[];
    assignedBy: string;
  }
): Promise<{ ok: true; primaryAssigneeId: string } | { ok: false; message: string }> {
  const nextAssigneeIds = uniqueIds(assigneeProfileIds);

  if (nextAssigneeIds.length === 0) {
    return { ok: false, message: "At least one assignee is required." };
  }

  const staffValidation = await validateCrmStaffProfileIds(
    supabase,
    nextAssigneeIds
  );

  if (!staffValidation.ok) {
    return staffValidation;
  }

  const { error: insertError } = await supabase.from("task_assignees").insert(
    nextAssigneeIds.map((profileId) => ({
      task_id: taskId,
      profile_id: profileId,
      assigned_by: assignedBy,
    }))
  );

  if (insertError) {
    return { ok: false, message: insertError.message };
  }

  return { ok: true, primaryAssigneeId: nextAssigneeIds[0] };
}
