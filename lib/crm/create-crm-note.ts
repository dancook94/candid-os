import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  formatCrmNoteTypeLabel,
  isCrmNoteType,
  type CrmNoteType,
} from "@/lib/crm/crm-note-types";
import { validateCrmLinks, type CrmRecordLinks } from "@/lib/crm/validate-crm-links";

export type CreateCrmNoteInput = CrmRecordLinks & {
  body: string;
  noteType: string;
  isPinned?: boolean;
  createdBy: string;
};

export async function createCrmNote(
  supabase: SupabaseClient,
  input: CreateCrmNoteInput
) {
  const body = input.body.trim();

  if (!body) {
    throw new Error("Note body is required.");
  }

  if (!isCrmNoteType(input.noteType)) {
    throw new Error("Invalid note type.");
  }

  const noteType = input.noteType as CrmNoteType;
  const validation = await validateCrmLinks(supabase, input);

  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const { links } = validation;

  const { data: note, error } = await supabase
    .from("crm_notes")
    .insert({
      body,
      company_id: links.companyId,
      contact_id: links.contactId,
      opportunity_id: links.opportunityId,
      quote_id: links.quoteId,
      task_id: links.taskId,
      created_by: input.createdBy,
      is_pinned: input.isPinned ?? false,
    })
    .select("id")
    .single();

  if (error || !note) {
    throw new Error(error?.message ?? "Unable to create note.");
  }

  await createCrmActivity(supabase, {
    ...links,
    activityType: CRM_ACTIVITY_TYPES.noteAdded,
    description: `${formatCrmNoteTypeLabel(noteType)} added.`,
    metadata: {
      note_id: note.id,
      note_type: noteType,
    },
    actorProfileId: input.createdBy,
  });

  return note.id;
}
