import type { SupabaseClient } from "@supabase/supabase-js";

import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { validateCrmStaffProfileIds } from "@/lib/crm/validate-crm-staff-ids";

export type UpdateOpportunityAssignmentsInput = {
  opportunityId: string;
  ownerProfileId: string;
  collaboratorProfileIds: string[];
  updatedBy: string;
};

export type UpdateOpportunityAssignmentsResult =
  | { ok: true }
  | { ok: false; message: string };

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function staffNameById(
  profiles: { id: string; full_name: string | null }[],
  profileId: string
) {
  const profile = profiles.find((entry) => entry.id === profileId);
  return profile ? getStaffDisplayName(profile) : "Unknown staff member";
}

export async function updateOpportunityAssignments(
  supabase: SupabaseClient,
  input: UpdateOpportunityAssignmentsInput
): Promise<UpdateOpportunityAssignmentsResult> {
  const collaboratorProfileIds = uniqueIds(input.collaboratorProfileIds).filter(
    (id) => id !== input.ownerProfileId
  );

  const staffValidation = await validateCrmStaffProfileIds(supabase, [
    input.ownerProfileId,
    ...collaboratorProfileIds,
  ]);

  if (!staffValidation.ok) {
    return staffValidation;
  }

  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("id, owner_profile_id")
    .eq("id", input.opportunityId)
    .maybeSingle();

  if (opportunityError) {
    return { ok: false, message: opportunityError.message };
  }

  if (!opportunity) {
    return { ok: false, message: "Opportunity not found." };
  }

  const { data: existingMembers, error: membersError } = await supabase
    .from("opportunity_members")
    .select("profile_id")
    .eq("opportunity_id", input.opportunityId);

  if (membersError) {
    return { ok: false, message: membersError.message };
  }

  const previousOwnerId = opportunity.owner_profile_id;
  const previousCollaboratorIds = (existingMembers ?? []).map(
    (member) => member.profile_id
  );

  if (previousOwnerId !== input.ownerProfileId) {
    const { error: ownerError } = await supabase
      .from("opportunities")
      .update({ owner_profile_id: input.ownerProfileId })
      .eq("id", input.opportunityId);

    if (ownerError) {
      return { ok: false, message: ownerError.message };
    }

    await logOpportunityActivity(supabase, {
      opportunityId: input.opportunityId,
      activityType: OPPORTUNITY_ACTIVITY_TYPES.ownerChanged,
      description: "Opportunity owner changed.",
      metadata: {
        from_profile_id: previousOwnerId,
        to_profile_id: input.ownerProfileId,
        from_name: staffNameById(staffValidation.profiles, previousOwnerId),
        to_name: staffNameById(staffValidation.profiles, input.ownerProfileId),
      },
      createdBy: input.updatedBy,
    });
  }

  const toAdd = collaboratorProfileIds.filter(
    (id) => !previousCollaboratorIds.includes(id)
  );
  const toRemove = previousCollaboratorIds.filter(
    (id) => !collaboratorProfileIds.includes(id)
  );

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("opportunity_members")
      .delete()
      .eq("opportunity_id", input.opportunityId)
      .in("profile_id", toRemove);

    if (deleteError) {
      return { ok: false, message: deleteError.message };
    }

    for (const profileId of toRemove) {
      await logOpportunityActivity(supabase, {
        opportunityId: input.opportunityId,
        activityType: OPPORTUNITY_ACTIVITY_TYPES.collaboratorRemoved,
        description: `${staffNameById(staffValidation.profiles, profileId)} removed as collaborator.`,
        metadata: {
          profile_id: profileId,
          profile_name: staffNameById(staffValidation.profiles, profileId),
        },
        createdBy: input.updatedBy,
      });
    }
  }

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase
      .from("opportunity_members")
      .insert(
        toAdd.map((profileId) => ({
          opportunity_id: input.opportunityId,
          profile_id: profileId,
        }))
      );

    if (insertError) {
      return { ok: false, message: insertError.message };
    }

    for (const profileId of toAdd) {
      await logOpportunityActivity(supabase, {
        opportunityId: input.opportunityId,
        activityType: OPPORTUNITY_ACTIVITY_TYPES.collaboratorAdded,
        description: `${staffNameById(staffValidation.profiles, profileId)} added as collaborator.`,
        metadata: {
          profile_id: profileId,
          profile_name: staffNameById(staffValidation.profiles, profileId),
        },
        createdBy: input.updatedBy,
      });
    }
  }

  return { ok: true };
}
