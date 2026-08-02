import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";

export type QuoteFollowUpTaskRow = {
  id: string;
  title: string;
  status: string;
  opportunity_id: string | null;
  company_id: string | null;
  quote_id: string | null;
};

export type CompleteQuoteFollowUpTasksResult = {
  completedTaskIds: string[];
  alreadyCompletedCount: number;
};

export function buildQuoteFollowUpTaskTitle(
  quoteNumber: number,
  projectName: string
) {
  return `Follow up Q-${quoteNumber} — ${projectName}`;
}

export function isQuoteFollowUpTaskTitle(title: string, quoteNumber: number) {
  return title.startsWith(`Follow up Q-${quoteNumber} — `);
}

function isOpenQuoteFollowUpTask(
  task: QuoteFollowUpTaskRow,
  quoteNumber: number
) {
  return (
    OPEN_TASK_STATUSES.includes(task.status as (typeof OPEN_TASK_STATUSES)[number]) &&
    isQuoteFollowUpTaskTitle(task.title, quoteNumber)
  );
}

async function loadAcceptedQuoteContext(
  adminClient: SupabaseClient,
  quoteId: string
) {
  const { data: quote, error } = await adminClient
    .from("quotes")
    .select(
      "id, quote_number, project_name, status, opportunity_id, company_id"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!quote || quote.status !== "accepted") {
    return null;
  }

  return quote;
}

async function findOpenQuoteFollowUpTasks(
  adminClient: SupabaseClient,
  {
    quoteId,
    quoteNumber,
    opportunityId,
  }: {
    quoteId: string;
    quoteNumber: number;
    opportunityId: string | null;
  }
) {
  const matched = new Map<string, QuoteFollowUpTaskRow>();

  const { data: byQuote, error: byQuoteError } = await adminClient
    .from("tasks")
    .select("id, title, status, opportunity_id, company_id, quote_id")
    .eq("quote_id", quoteId)
    .in("status", [...OPEN_TASK_STATUSES]);

  if (byQuoteError) {
    throw new Error(byQuoteError.message);
  }

  for (const task of (byQuote ?? []) as QuoteFollowUpTaskRow[]) {
    if (isOpenQuoteFollowUpTask(task, quoteNumber)) {
      matched.set(task.id, task);
    }
  }

  if (opportunityId) {
    const { data: legacyTasks, error: legacyError } = await adminClient
      .from("tasks")
      .select("id, title, status, opportunity_id, company_id, quote_id")
      .eq("opportunity_id", opportunityId)
      .is("quote_id", null)
      .in("status", [...OPEN_TASK_STATUSES]);

    if (legacyError) {
      throw new Error(legacyError.message);
    }

    for (const task of (legacyTasks ?? []) as QuoteFollowUpTaskRow[]) {
      if (isOpenQuoteFollowUpTask(task, quoteNumber)) {
        matched.set(task.id, task);
      }
    }
  }

  return [...matched.values()];
}

async function hasAutoCompleteActivity(
  adminClient: SupabaseClient,
  quoteId: string,
  taskId: string
) {
  const { data, error } = await adminClient
    .from("crm_activity")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("task_id", taskId)
    .eq("activity_type", CRM_ACTIVITY_TYPES.quoteFollowUpTaskAutoCompleted)
    .limit(1);

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[tasks] failed to check auto-complete activity", {
        quoteId,
        taskId,
        message: error.message,
      });
    }

    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function logQuoteFollowUpTaskAutoCompleted({
  adminClient,
  task,
  quoteId,
  opportunityId,
  jobId,
  actorProfileId,
}: {
  adminClient: SupabaseClient;
  task: QuoteFollowUpTaskRow;
  quoteId: string;
  opportunityId: string | null;
  jobId: string | null;
  actorProfileId?: string | null;
}) {
  const alreadyLogged = await hasAutoCompleteActivity(adminClient, quoteId, task.id);

  if (alreadyLogged) {
    return;
  }

  await logOpportunityActivity(adminClient, {
    opportunityId: task.opportunity_id ?? opportunityId,
    companyId: task.company_id,
    quoteId,
    taskId: task.id,
    activityType: CRM_ACTIVITY_TYPES.quoteFollowUpTaskAutoCompleted,
    description: `Follow-up task "${task.title}" completed automatically after quote acceptance.`,
    metadata: {
      trigger: "quote_accepted",
      task_id: task.id,
      quote_id: quoteId,
      opportunity_id: opportunityId,
      job_id: jobId,
      auto_completed: true,
      acceptance_actor_profile_id: actorProfileId ?? null,
    },
    createdBy: actorProfileId ?? null,
  });
}

export async function completeQuoteFollowUpTasksForAcceptedQuote(
  adminClient: SupabaseClient,
  {
    quoteId,
    actorProfileId,
    jobId = null,
  }: {
    quoteId: string;
    actorProfileId?: string | null;
    jobId?: string | null;
  }
): Promise<CompleteQuoteFollowUpTasksResult> {
  const quote = await loadAcceptedQuoteContext(adminClient, quoteId);

  if (!quote) {
    return { completedTaskIds: [], alreadyCompletedCount: 0 };
  }

  const openTasks = await findOpenQuoteFollowUpTasks(adminClient, {
    quoteId: quote.id,
    quoteNumber: quote.quote_number,
    opportunityId: quote.opportunity_id,
  });

  if (openTasks.length === 0) {
    return { completedTaskIds: [], alreadyCompletedCount: 0 };
  }

  const completedAt = new Date().toISOString();
  const completedTaskIds: string[] = [];

  for (const task of openTasks) {
    if (task.status === "completed") {
      continue;
    }

    const { data: updatedTask, error: updateError } = await adminClient
      .from("tasks")
      .update({
        status: "completed",
        completed_at: completedAt,
      })
      .eq("id", task.id)
      .in("status", [...OPEN_TASK_STATUSES])
      .select("id")
      .maybeSingle();

    if (updateError) {
      if (process.env.NODE_ENV === "development") {
        console.error("[tasks] failed to auto-complete quote follow-up task", {
          quoteId,
          taskId: task.id,
          message: updateError.message,
        });
      }

      continue;
    }

    if (!updatedTask) {
      continue;
    }

    completedTaskIds.push(updatedTask.id);

    try {
      await logQuoteFollowUpTaskAutoCompleted({
        adminClient,
        task,
        quoteId: quote.id,
        opportunityId: quote.opportunity_id,
        jobId,
        actorProfileId,
      });
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[tasks] failed to log quote follow-up auto-complete activity", {
          quoteId,
          taskId: task.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    completedTaskIds,
    alreadyCompletedCount: 0,
  };
}
