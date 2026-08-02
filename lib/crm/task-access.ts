import type { SupabaseClient } from "@supabase/supabase-js";

export async function canAccessTask(
  supabase: SupabaseClient,
  taskId: string,
  userId: string,
  userRole: string
): Promise<boolean> {
  if (["super_admin", "admin"].includes(userRole)) {
    return true;
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("assigned_to, created_by, opportunity_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return false;
  }

  if (task.assigned_to === userId || task.created_by === userId) {
    return true;
  }

  const { data: assigneeRow } = await supabase
    .from("task_assignees")
    .select("profile_id")
    .eq("task_id", taskId)
    .eq("profile_id", userId)
    .maybeSingle();

  if (assigneeRow) {
    return true;
  }

  if (task.opportunity_id) {
    const { data: opportunity } = await supabase
      .from("opportunities")
      .select("owner_profile_id, created_by")
      .eq("id", task.opportunity_id)
      .maybeSingle();

    if (
      opportunity &&
      (opportunity.owner_profile_id === userId ||
        opportunity.created_by === userId)
    ) {
      return true;
    }

    const { data: member } = await supabase
      .from("opportunity_members")
      .select("profile_id")
      .eq("opportunity_id", task.opportunity_id)
      .eq("profile_id", userId)
      .maybeSingle();

    if (member) {
      return true;
    }
  }

  return false;
}
