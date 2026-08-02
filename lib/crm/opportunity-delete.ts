import type { SupabaseClient } from "@supabase/supabase-js";

export type OpportunityDeletionBlockers = {
  linkedQuoteCount: number;
  openTaskCount: number;
  canDelete: boolean;
  blockReason: string | null;
};

export type PermanentDeleteOpportunityResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

const LINKED_QUOTES_MESSAGE =
  "This opportunity has linked quotes and cannot be deleted until they are removed or reassigned.";

const OPEN_TASKS_MESSAGE =
  "This opportunity has open tasks. Complete, cancel, or reassign them before deletion.";

export function mapOpportunityDeleteError(message: string): {
  status: number;
  message: string;
} {
  if (message.includes("linked quotes")) {
    return { status: 409, message: LINKED_QUOTES_MESSAGE };
  }

  if (message.includes("open tasks")) {
    return { status: 409, message: OPEN_TASKS_MESSAGE };
  }

  if (message.includes("Opportunity not found")) {
    return { status: 404, message: "Opportunity not found." };
  }

  if (
    message.includes("Admin access required") ||
    message.includes("Authentication required") ||
    message.includes("insufficient_privilege")
  ) {
    return { status: 403, message: "You do not have permission to delete opportunities." };
  }

  return { status: 500, message };
}

export async function getOpportunityDeletionBlockers(
  supabase: SupabaseClient,
  opportunityId: string
): Promise<OpportunityDeletionBlockers> {
  const [{ count: linkedQuoteCount, error: quoteError }, { count: openTaskCount, error: taskError }] =
    await Promise.all([
      supabase
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("opportunity_id", opportunityId),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("opportunity_id", opportunityId)
        .in("status", ["open", "in_progress"]),
    ]);

  if (quoteError) {
    throw new Error(quoteError.message);
  }

  if (taskError) {
    throw new Error(taskError.message);
  }

  const quotes = linkedQuoteCount ?? 0;
  const openTasks = openTaskCount ?? 0;

  if (quotes > 0) {
    return {
      linkedQuoteCount: quotes,
      openTaskCount: openTasks,
      canDelete: false,
      blockReason: LINKED_QUOTES_MESSAGE,
    };
  }

  if (openTasks > 0) {
    return {
      linkedQuoteCount: quotes,
      openTaskCount: openTasks,
      canDelete: false,
      blockReason: OPEN_TASKS_MESSAGE,
    };
  }

  return {
    linkedQuoteCount: quotes,
    openTaskCount: openTasks,
    canDelete: true,
    blockReason: null,
  };
}

export async function permanentlyDeleteOpportunityAsAdmin(
  supabase: SupabaseClient,
  {
    opportunityId,
    confirmationTitle,
    deletedBy,
    opportunityTitle,
    companyId,
  }: {
    opportunityId: string;
    confirmationTitle: string;
    deletedBy: string;
    opportunityTitle: string;
    companyId: string;
  }
): Promise<PermanentDeleteOpportunityResult> {
  if (confirmationTitle.trim() !== opportunityTitle.trim()) {
    return {
      ok: false,
      status: 400,
      message: "Confirmation text must match the opportunity title exactly.",
    };
  }

  const blockers = await getOpportunityDeletionBlockers(supabase, opportunityId);

  if (!blockers.canDelete && blockers.blockReason) {
    return { ok: false, status: 409, message: blockers.blockReason };
  }

  const deletedAt = new Date().toISOString();

  const { error: deleteError } = await supabase.rpc("permanently_delete_opportunity", {
    p_opportunity_id: opportunityId,
    p_deleted_by: deletedBy,
    p_description: `Opportunity ${opportunityTitle.trim()} was permanently deleted.`,
    p_metadata: {
      deleted_opportunity_id: opportunityId,
      opportunity_title: opportunityTitle.trim(),
      company_id: companyId,
      deleted_by: deletedBy,
      deleted_at: deletedAt,
    },
  });

  if (deleteError) {
    const mapped = mapOpportunityDeleteError(deleteError.message);
    return { ok: false, status: mapped.status, message: mapped.message };
  }

  return { ok: true };
}
