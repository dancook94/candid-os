import type { SupabaseClient } from "@supabase/supabase-js";

import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { validateActiveContactForCompany } from "@/lib/crm/contact-validation";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import type { OpportunitySource, OpportunityStage } from "@/lib/crm/types";

export type CreateOpportunityInput = {
  companyId: string;
  contactId: string;
  title: string;
  description?: string | null;
  estimatedValue?: number | null;
  stage?: OpportunityStage;
  ownerProfileId: string;
  collaboratorProfileIds?: string[];
  source?: OpportunitySource;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
  createdBy: string;
};

export type UpdateOpportunityInput = {
  opportunityId: string;
  contactId?: string;
  companyId?: string;
  title?: string;
  description?: string | null;
  estimatedValue?: number | null;
  stage?: OpportunityStage;
  source?: OpportunitySource;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
  timestamps?: Record<string, string | null>;
  updatedBy: string;
};

function buildStageTimestampsForCreate(stage: OpportunityStage) {
  const now = new Date().toISOString();

  if (stage === "won") {
    return { won_at: now, lost_at: null, lost_reason: null };
  }

  if (stage === "lost") {
    return { won_at: null, lost_at: now };
  }

  return { won_at: null, lost_at: null, lost_reason: null };
}

export async function createOpportunityWithContact(
  supabase: SupabaseClient,
  input: CreateOpportunityInput
) {
  const contactValidation = await validateActiveContactForCompany(
    supabase,
    input.contactId,
    input.companyId,
    { required: true }
  );

  if (!contactValidation.ok) {
    throw new Error(contactValidation.message);
  }

  const stage = input.stage ?? "new_enquiry";
  const timestamps = buildStageTimestampsForCreate(stage);

  const { data: created, error: insertError } = await supabase
    .from("opportunities")
    .insert({
      company_id: input.companyId,
      contact_id: input.contactId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      estimated_value: input.estimatedValue ?? null,
      currency: "GBP",
      stage,
      owner_profile_id: input.ownerProfileId,
      expected_close_date: input.expectedCloseDate ?? null,
      next_follow_up_at: input.nextFollowUpAt ?? null,
      source: input.source ?? "admin",
      lost_reason: stage === "lost" ? input.lostReason?.trim() || null : null,
      created_by: input.createdBy,
      ...timestamps,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message ?? "Unable to create opportunity.");
  }

  const collaboratorIds = input.collaboratorProfileIds ?? [];

  if (collaboratorIds.length > 0) {
    const { error: membersError } = await supabase
      .from("opportunity_members")
      .insert(
        collaboratorIds.map((profileId) => ({
          opportunity_id: created.id,
          profile_id: profileId,
        }))
      );

    if (membersError) {
      throw new Error(membersError.message);
    }
  }

  await logOpportunityActivity(supabase, {
    opportunityId: created.id,
    activityType: OPPORTUNITY_ACTIVITY_TYPES.opportunityCreated,
    description: `Opportunity "${input.title.trim()}" created.`,
    createdBy: input.createdBy,
  });

  return created.id;
}

export async function updateOpportunityContact(
  supabase: SupabaseClient,
  {
    opportunityId,
    contactId,
    companyId,
    updatedBy,
  }: {
    opportunityId: string;
    contactId: string;
    companyId: string;
    updatedBy: string;
  }
) {
  const contactValidation = await validateActiveContactForCompany(
    supabase,
    contactId,
    companyId,
    { required: true }
  );

  if (!contactValidation.ok) {
    throw new Error(contactValidation.message);
  }

  const { data: existing, error: existingError } = await supabase
    .from("opportunities")
    .select("id, company_id, contact_id")
    .eq("id", opportunityId)
    .maybeSingle();

  if (existingError || !existing) {
    throw new Error(existingError?.message ?? "Opportunity not found.");
  }

  if (existing.company_id !== companyId) {
    throw new Error("Contact must belong to the opportunity company.");
  }

  if (existing.contact_id === contactId) {
    return { changed: false as const };
  }

  const previousContactId = existing.contact_id;
  let previousContactName: string | null = null;

  if (previousContactId) {
    const { data: previousContact } = await supabase
      .from("contacts")
      .select("full_name")
      .eq("id", previousContactId)
      .maybeSingle();

    previousContactName = previousContact?.full_name ?? null;
  }

  const { error: updateError } = await supabase
    .from("opportunities")
    .update({ contact_id: contactId })
    .eq("id", opportunityId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await logOpportunityActivity(supabase, {
    opportunityId,
    activityType: OPPORTUNITY_ACTIVITY_TYPES.contactChanged,
    description: "Opportunity contact updated.",
    metadata: {
      previous_contact_id: previousContactId,
      new_contact_id: contactId,
      previous_contact_name: previousContactName,
      new_contact_name: contactValidation.contact.full_name,
    },
    createdBy: updatedBy,
  });

  return { changed: true as const };
}

export async function updateOpportunityFields(
  supabase: SupabaseClient,
  input: UpdateOpportunityInput
) {
  const { data: existing, error: existingError } = await supabase
    .from("opportunities")
    .select("id, company_id, contact_id, stage")
    .eq("id", input.opportunityId)
    .maybeSingle();

  if (existingError || !existing) {
    throw new Error(existingError?.message ?? "Opportunity not found.");
  }

  const companyId = input.companyId ?? existing.company_id;
  const nextContactId = input.contactId ?? existing.contact_id;
  const isTerminalStage = existing.stage === "won" || existing.stage === "lost";

  const contactValidation = await validateActiveContactForCompany(
    supabase,
    nextContactId,
    companyId,
    { required: !isTerminalStage }
  );

  if (!contactValidation.ok) {
    throw new Error(contactValidation.message);
  }

  const { error: updateError } = await supabase
    .from("opportunities")
    .update({
      ...(input.companyId ? { company_id: input.companyId } : {}),
      ...(input.contactId ? { contact_id: input.contactId } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.estimatedValue !== undefined
        ? { estimated_value: input.estimatedValue }
        : {}),
      ...(input.stage !== undefined ? { stage: input.stage } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.expectedCloseDate !== undefined
        ? { expected_close_date: input.expectedCloseDate }
        : {}),
      ...(input.nextFollowUpAt !== undefined
        ? { next_follow_up_at: input.nextFollowUpAt }
        : {}),
      ...(input.lostReason !== undefined
        ? { lost_reason: input.lostReason?.trim() || null }
        : {}),
      ...(input.timestamps ?? {}),
    })
    .eq("id", input.opportunityId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (
    input.contactId &&
    input.contactId !== existing.contact_id
  ) {
    let previousContactName: string | null = null;

    if (existing.contact_id) {
      const { data: previousContact } = await supabase
        .from("contacts")
        .select("full_name")
        .eq("id", existing.contact_id)
        .maybeSingle();

      previousContactName = previousContact?.full_name ?? null;
    }

    await logOpportunityActivity(supabase, {
      opportunityId: input.opportunityId,
      activityType: OPPORTUNITY_ACTIVITY_TYPES.contactChanged,
      description: "Opportunity contact updated.",
      metadata: {
        previous_contact_id: existing.contact_id,
        new_contact_id: input.contactId,
        previous_contact_name: previousContactName,
        new_contact_name: contactValidation.contact.full_name,
      },
      createdBy: input.updatedBy,
    });
  }

  return { ok: true as const };
}
