import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { LOST_REASON_QUOTE_DECLINED } from "@/lib/crm/lost-reasons";
import { buildQuoteFollowUpTaskTitle } from "@/lib/crm/complete-quote-follow-up-tasks";
import {
  formatOpportunityStageLabel,
  isOpportunityStage,
} from "@/lib/crm/opportunity-stages";
import type { OpportunityStage } from "@/lib/crm/types";

export type QuoteOpportunitySyncEvent =
  | "quote_draft_created"
  | "quote_sent"
  | "quote_accepted"
  | "quote_declined";

export type ManualStageChangeInput = {
  opportunityId: string;
  newStage: OpportunityStage;
  previousStage: OpportunityStage;
  changedBy: string;
  lostReason?: string | null;
};

export type StageSyncResult =
  | { ok: true; opportunityId: string; stage: OpportunityStage }
  | { ok: false; message: string };

function stageFromQuoteEvent(
  event: QuoteOpportunitySyncEvent
): OpportunityStage | null {
  switch (event) {
    case "quote_draft_created":
      return "quote_in_progress";
    case "quote_sent":
      return "quote_sent";
    case "quote_accepted":
      return "won";
    case "quote_declined":
      return "lost";
    default:
      return null;
  }
}

function buildTerminalFields(
  stage: OpportunityStage,
  lostReason?: string | null
) {
  const now = new Date().toISOString();

  if (stage === "won") {
    return {
      won_at: now,
      lost_at: null,
      lost_reason: null,
    };
  }

  if (stage === "lost") {
    return {
      won_at: null,
      lost_at: now,
      lost_reason: lostReason?.trim() || LOST_REASON_QUOTE_DECLINED,
    };
  }

  return {
    won_at: null,
    lost_at: null,
    lost_reason: null,
  };
}

export async function logOpportunityActivity(
  supabase: SupabaseClient,
  {
    opportunityId,
    companyId,
    contactId,
    quoteId,
    taskId,
    activityType,
    description,
    metadata,
    createdBy,
  }: {
    opportunityId?: string | null;
    companyId?: string | null;
    contactId?: string | null;
    quoteId?: string | null;
    taskId?: string | null;
    activityType: string;
    description: string;
    metadata?: Record<string, unknown>;
    createdBy: string | null;
  }
) {
  let resolvedCompanyId = companyId ?? null;
  let resolvedContactId = contactId ?? null;

  if (opportunityId && (!resolvedCompanyId || !resolvedContactId)) {
    const { data: opportunity } = await supabase
      .from("opportunities")
      .select("company_id, contact_id")
      .eq("id", opportunityId)
      .maybeSingle();

    resolvedCompanyId = resolvedCompanyId ?? opportunity?.company_id ?? null;
    resolvedContactId = resolvedContactId ?? opportunity?.contact_id ?? null;
  }

  await createCrmActivity(supabase, {
    companyId: resolvedCompanyId,
    contactId: resolvedContactId,
    opportunityId: opportunityId ?? null,
    quoteId: quoteId ?? null,
    taskId: taskId ?? null,
    activityType,
    description,
    metadata,
    actorProfileId: createdBy,
  });
}

export async function applyManualOpportunityStageChange(
  supabase: SupabaseClient,
  input: ManualStageChangeInput
): Promise<StageSyncResult> {
  if (!isOpportunityStage(input.newStage)) {
    return { ok: false, message: "Invalid stage." };
  }

  if (input.newStage === "lost" && !input.lostReason?.trim()) {
    return { ok: false, message: "Lost reason is required." };
  }

  const timestamps = buildTerminalFields(input.newStage, input.lostReason);
  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("opportunities")
    .update({
      stage: input.newStage,
      ...timestamps,
      updated_at: now,
    })
    .eq("id", input.opportunityId)
    .select("id, stage")
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }

  if (!updated) {
    return { ok: false, message: "Opportunity not found or access denied." };
  }

  const activityType =
    input.newStage === "won"
      ? CRM_ACTIVITY_TYPES.opportunityWon
      : input.newStage === "lost"
        ? CRM_ACTIVITY_TYPES.opportunityLost
        : CRM_ACTIVITY_TYPES.stageChanged;

  await logOpportunityActivity(supabase, {
    opportunityId: input.opportunityId,
    activityType,
    description: `Stage changed from ${formatOpportunityStageLabel(input.previousStage)} to ${formatOpportunityStageLabel(input.newStage)}.`,
    metadata: {
      previous_stage: input.previousStage,
      new_stage: input.newStage,
      changed_by: input.changedBy,
      changed_at: now,
    },
    createdBy: input.changedBy,
  });

  return {
    ok: true,
    opportunityId: updated.id,
    stage: updated.stage as OpportunityStage,
  };
}

export async function syncOpportunityFromQuoteEvent(
  supabase: SupabaseClient,
  {
    quoteId,
    event,
    changedBy,
    lostReason,
  }: {
    quoteId: string;
    event: QuoteOpportunitySyncEvent;
    changedBy: string;
    lostReason?: string;
  }
): Promise<StageSyncResult | { ok: true; skipped: true; reason: string }> {
  const targetStage = stageFromQuoteEvent(event);

  if (!targetStage) {
    return { ok: false, message: "Unknown quote event." };
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, opportunity_id, status, current_version, quote_number, project_name, company_id"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return { ok: false, message: quoteError.message };
  }

  if (!quote?.opportunity_id) {
    return { ok: true, skipped: true, reason: "Quote is not linked to an opportunity." };
  }

  if (event === "quote_sent" || event === "quote_accepted" || event === "quote_declined") {
    const { data: currentVersion } = await supabase
      .from("quote_versions")
      .select("version_number, version_status")
      .eq("quote_id", quote.id)
      .eq("version_number", quote.current_version)
      .maybeSingle();

    const expectedStatus =
      event === "quote_sent"
        ? "sent"
        : event === "quote_accepted"
          ? "accepted"
          : "declined";

    if (
      !currentVersion ||
      currentVersion.version_status !== expectedStatus ||
      quote.status !== expectedStatus
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "Only the current quote version triggers stage sync.",
      };
    }
  }

  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("id, stage")
    .eq("id", quote.opportunity_id)
    .maybeSingle();

  if (opportunityError) {
    return { ok: false, message: opportunityError.message };
  }

  if (!opportunity) {
    return { ok: false, message: "Linked opportunity not found." };
  }

  const previousStage = opportunity.stage as OpportunityStage;

  if (previousStage === targetStage) {
    return {
      ok: true,
      opportunityId: opportunity.id,
      stage: targetStage,
    };
  }

  const timestamps = buildTerminalFields(
    targetStage,
    event === "quote_declined"
      ? lostReason ?? LOST_REASON_QUOTE_DECLINED
      : null
  );
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("opportunities")
    .update({
      stage: targetStage,
      ...timestamps,
      updated_at: now,
    })
    .eq("id", opportunity.id)
    .select("id, stage")
    .maybeSingle();

  if (updateError) {
    return { ok: false, message: updateError.message };
  }

  if (!updated) {
    return { ok: false, message: "Unable to update opportunity stage." };
  }

  const activityType =
    event === "quote_draft_created"
      ? CRM_ACTIVITY_TYPES.quoteCreated
      : event === "quote_sent"
        ? CRM_ACTIVITY_TYPES.quoteSent
        : event === "quote_accepted"
          ? CRM_ACTIVITY_TYPES.quoteAccepted
          : event === "quote_declined"
            ? CRM_ACTIVITY_TYPES.quoteDeclined
            : CRM_ACTIVITY_TYPES.stageChanged;

  const description =
    event === "quote_draft_created"
      ? `Quote Q-${quote.quote_number} draft linked.`
      : event === "quote_sent"
        ? `Quote Q-${quote.quote_number} was sent.`
        : event === "quote_accepted"
          ? `Quote Q-${quote.quote_number} was accepted.`
          : event === "quote_declined"
            ? `Quote Q-${quote.quote_number} was declined.`
            : `Stage changed from ${formatOpportunityStageLabel(previousStage)} to ${formatOpportunityStageLabel(targetStage)}.`;

  await logOpportunityActivity(supabase, {
    opportunityId: opportunity.id,
    companyId: quote.company_id,
    quoteId: quote.id,
    activityType,
    description,
    metadata: {
      previous_stage: previousStage,
      new_stage: targetStage,
      changed_by: changedBy,
      changed_at: now,
      quote_id: quote.id,
      quote_event: event,
    },
    createdBy: changedBy,
  });

  if (event === "quote_sent") {
    await ensureQuoteFollowUpTask(supabase, {
      quoteId: quote.id,
      opportunityId: opportunity.id,
      companyId: quote.company_id,
      quoteNumber: quote.quote_number,
      projectName: quote.project_name,
      ownerProfileId: changedBy,
      createdBy: changedBy,
      sentAt: now,
    });
  }

  return {
    ok: true,
    opportunityId: updated.id,
    stage: updated.stage as OpportunityStage,
  };
}

export async function ensureQuoteFollowUpTask(
  supabase: SupabaseClient,
  {
    quoteId,
    opportunityId,
    companyId,
    quoteNumber,
    projectName,
    ownerProfileId,
    createdBy,
    sentAt,
  }: {
    quoteId: string;
    opportunityId: string;
    companyId: string;
    quoteNumber: number;
    projectName: string;
    ownerProfileId: string;
    createdBy: string;
    sentAt: string;
  }
) {
  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("owner_profile_id")
    .eq("id", opportunityId)
    .maybeSingle();

  const assigneeId = opportunity?.owner_profile_id ?? ownerProfileId;
  const now = new Date(sentAt);
  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + 5);

  const { data: existingByQuote } = await supabase
    .from("tasks")
    .select("id")
    .eq("quote_id", quoteId)
    .in("status", ["open", "in_progress"])
    .limit(1);

  if (existingByQuote && existingByQuote.length > 0) {
    return;
  }

  const { data: futureTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("opportunity_id", opportunityId)
    .in("status", ["open", "in_progress"])
    .gt("due_at", sentAt)
    .limit(1);

  if (futureTasks && futureTasks.length > 0) {
    return;
  }

  const title = buildQuoteFollowUpTaskTitle(quoteNumber, projectName);

  const { data: createdTask, error: taskError } = await supabase
    .from("tasks")
    .insert({
      title,
      description: null,
      assigned_to: assigneeId,
      created_by: createdBy,
      due_at: dueAt.toISOString(),
      status: "open",
      priority: "normal",
      opportunity_id: opportunityId,
      quote_id: quoteId,
      company_id: companyId,
    })
    .select("id")
    .single();

  if (taskError || !createdTask) {
    throw new Error(taskError?.message ?? "Unable to create follow-up task.");
  }

  const { error: assigneeError } = await supabase.from("task_assignees").insert({
    task_id: createdTask.id,
    profile_id: assigneeId,
    assigned_by: createdBy,
  });

  if (assigneeError) {
    throw new Error(assigneeError.message);
  }

  await logOpportunityActivity(supabase, {
    opportunityId,
    companyId,
    quoteId,
    taskId: createdTask.id,
    activityType: CRM_ACTIVITY_TYPES.taskCreated,
    description: `Follow-up task created: ${title}`,
    metadata: { quote_id: quoteId, automated: true },
    createdBy: createdBy,
  });
}
