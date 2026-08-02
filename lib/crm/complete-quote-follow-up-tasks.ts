import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";
import {
  QUOTE_FOLLOW_UP_AUTOMATION_KEY,
  supportsTaskAutomationKey,
  type QuoteFollowUpCompletionTrigger,
} from "@/lib/crm/task-automation-key";

export type QuoteFollowUpTaskRow = {
  id: string;
  title: string;
  status: string;
  opportunity_id: string | null;
  company_id: string | null;
  quote_id: string | null;
  automation_key?: string | null;
};

export type CompleteQuoteFollowUpTasksResult = {
  completedTaskIds: string[];
  alreadyCompletedCount: number;
  matchedTaskIds: string[];
  errors: string[];
};

const TASK_SELECT_BASE =
  "id, title, status, opportunity_id, company_id, quote_id";

const TASK_SELECT =
  `${TASK_SELECT_BASE}, automation_key`;

export function buildQuoteFollowUpTaskTitle(
  quoteNumber: number,
  projectName: string
) {
  return `Follow up Q-${quoteNumber} — ${projectName}`;
}

export function buildQuoteFollowUpTitleReference(quoteNumber: number) {
  return `Q-${quoteNumber}`;
}

export function isQuoteFollowUpTaskTitle(title: string, quoteNumber: number) {
  return title.startsWith(`Follow up Q-${quoteNumber} — `);
}

export function titleReferencesQuote(title: string, quoteNumber: number) {
  return title.includes(buildQuoteFollowUpTitleReference(quoteNumber));
}

function isStructuredQuoteFollowUpTask(task: QuoteFollowUpTaskRow) {
  return task.automation_key === QUOTE_FOLLOW_UP_AUTOMATION_KEY;
}

function isLegacyQuoteFollowUpTask(task: QuoteFollowUpTaskRow, quoteNumber: number) {
  const titleLooksLikeFollowUp =
    task.title.startsWith("Follow up ") || task.title.startsWith("Follow-up ");

  return (
    titleLooksLikeFollowUp && titleReferencesQuote(task.title, quoteNumber)
  );
}

export function isQuoteFollowUpTaskCandidate(
  task: QuoteFollowUpTaskRow,
  quoteNumber: number
) {
  if (isStructuredQuoteFollowUpTask(task)) {
    return true;
  }

  return isQuoteFollowUpTaskTitle(task.title, quoteNumber);
}

function isOpenTaskStatus(status: string) {
  return OPEN_TASK_STATUSES.includes(status as (typeof OPEN_TASK_STATUSES)[number]);
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

function selectOpenTasks(
  adminClient: SupabaseClient,
  useAutomationKey: boolean
) {
  return adminClient
    .from("tasks")
    .select(useAutomationKey ? TASK_SELECT : TASK_SELECT_BASE);
}

export async function findOpenQuoteFollowUpTasks(
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
  const useAutomationKey = await supportsTaskAutomationKey(adminClient);

  const { data: byQuote, error: byQuoteError } = await selectOpenTasks(
    adminClient,
    useAutomationKey
  )
    .eq("quote_id", quoteId)
    .in("status", [...OPEN_TASK_STATUSES]);

  if (byQuoteError) {
    throw new Error(byQuoteError.message);
  }

  for (const task of (byQuote ?? []) as unknown as QuoteFollowUpTaskRow[]) {
    if (isOpenTaskStatus(task.status) && isQuoteFollowUpTaskCandidate(task, quoteNumber)) {
      matched.set(task.id, task);
    }
  }

  if (opportunityId) {
    const { data: byOpportunity, error: byOpportunityError } = await selectOpenTasks(
      adminClient,
      useAutomationKey
    )
      .eq("opportunity_id", opportunityId)
      .in("status", [...OPEN_TASK_STATUSES]);

    if (byOpportunityError) {
      throw new Error(byOpportunityError.message);
    }

    for (const task of (byOpportunity ?? []) as unknown as QuoteFollowUpTaskRow[]) {
      if (!isOpenTaskStatus(task.status)) {
        continue;
      }

      if (task.quote_id && task.quote_id !== quoteId) {
        continue;
      }

      if (
        isQuoteFollowUpTaskCandidate(task, quoteNumber) ||
        (isLegacyQuoteFollowUpTask(task, quoteNumber) &&
          (task.quote_id === quoteId || !task.quote_id))
      ) {
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
    console.error("[tasks] failed to check quote follow-up auto-complete activity", {
      quoteId,
      taskId,
      code: error.code,
      message: error.message,
    });

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
  trigger,
}: {
  adminClient: SupabaseClient;
  task: QuoteFollowUpTaskRow;
  quoteId: string;
  opportunityId: string | null;
  jobId: string | null;
  actorProfileId?: string | null;
  trigger: QuoteFollowUpCompletionTrigger;
}) {
  const alreadyLogged = await hasAutoCompleteActivity(adminClient, quoteId, task.id);

  if (alreadyLogged) {
    return;
  }

  const description =
    trigger === "accepted_quote_reconciliation"
      ? `Follow-up task "${task.title}" completed during accepted-quote reconciliation.`
      : `Follow-up task "${task.title}" completed automatically after quote acceptance.`;

  await logOpportunityActivity(adminClient, {
    opportunityId: task.opportunity_id ?? opportunityId,
    companyId: task.company_id,
    quoteId,
    taskId: task.id,
    activityType: CRM_ACTIVITY_TYPES.quoteFollowUpTaskAutoCompleted,
    description,
    metadata: {
      trigger,
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
    trigger = "quote_accepted",
  }: {
    quoteId: string;
    actorProfileId?: string | null;
    jobId?: string | null;
    trigger?: QuoteFollowUpCompletionTrigger;
  }
): Promise<CompleteQuoteFollowUpTasksResult> {
  const errors: string[] = [];

  const quote = await loadAcceptedQuoteContext(adminClient, quoteId);

  if (!quote) {
    return {
      completedTaskIds: [],
      alreadyCompletedCount: 0,
      matchedTaskIds: [],
      errors: ["Quote is not accepted or could not be loaded."],
    };
  }

  const openTasks = await findOpenQuoteFollowUpTasks(adminClient, {
    quoteId: quote.id,
    quoteNumber: quote.quote_number,
    opportunityId: quote.opportunity_id,
  });

  if (openTasks.length === 0) {
    return {
      completedTaskIds: [],
      alreadyCompletedCount: 0,
      matchedTaskIds: [],
      errors: [],
    };
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
      .select("id, status, completed_at")
      .maybeSingle();

    if (updateError) {
      const message = `[tasks] failed to complete follow-up task ${task.id}: ${updateError.message}${updateError.code ? ` (${updateError.code})` : ""}`;
      console.error(message, {
        quoteId,
        taskId: task.id,
        details: updateError.details,
        hint: updateError.hint,
      });
      errors.push(message);
      continue;
    }

    if (!updatedTask) {
      const message = `[tasks] follow-up task ${task.id} was matched but not updated (status may have changed concurrently).`;
      console.error(message, { quoteId, taskId: task.id, taskStatus: task.status });
      errors.push(message);
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
        trigger,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to log quote follow-up auto-complete activity.";
      console.error("[tasks] activity logging failed", {
        quoteId,
        taskId: task.id,
        message,
      });
      errors.push(message);
    }
  }

  return {
    completedTaskIds,
    alreadyCompletedCount: 0,
    matchedTaskIds: openTasks.map((task) => task.id),
    errors,
  };
}

export async function loadOpenQuoteFollowUpTasksForQuote(
  adminClient: SupabaseClient,
  quoteId: string
) {
  const quote = await loadAcceptedQuoteContext(adminClient, quoteId);

  if (!quote) {
    return {
      quoteAccepted: false,
      openTasks: [] as QuoteFollowUpTaskRow[],
    };
  }

  const openTasks = await findOpenQuoteFollowUpTasks(adminClient, {
    quoteId: quote.id,
    quoteNumber: quote.quote_number,
    opportunityId: quote.opportunity_id,
  });

  return {
    quoteAccepted: true,
    openTasks,
  };
}
