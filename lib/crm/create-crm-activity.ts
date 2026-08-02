import type { SupabaseClient } from "@supabase/supabase-js";

import { validateCrmLinks, type CrmRecordLinks, type ValidatedCrmLinks } from "@/lib/crm/validate-crm-links";

const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "email_body",
  "raw_email",
  "auth",
  "secret",
  "body",
  "note_body",
]);

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    if (FORBIDDEN_METADATA_KEYS.has(lowerKey)) {
      continue;
    }

    if (typeof value === "string" && value.length > 2000) {
      sanitized[key] = `${value.slice(0, 2000)}…`;
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

export type CreateCrmActivityInput = CrmRecordLinks & {
  activityType: string;
  description: string;
  metadata?: Record<string, unknown>;
  actorProfileId?: string | null;
  validatedLinks?: ValidatedCrmLinks;
};

export async function createCrmActivity(
  supabase: SupabaseClient,
  input: CreateCrmActivityInput
): Promise<string> {
  const activityType = input.activityType.trim();
  const description = input.description.trim();

  if (!activityType) {
    throw new Error("Activity type is required.");
  }

  if (!description) {
    throw new Error("Activity description is required.");
  }

  let links: ValidatedCrmLinks;

  if (input.validatedLinks) {
    links = input.validatedLinks;
  } else {
    const validation = await validateCrmLinks(supabase, input);

    if (!validation.ok) {
      throw new Error(validation.message);
    }

    links = validation.links;
  }

  const { data: activity, error } = await supabase
    .from("crm_activity")
    .insert({
      activity_type: activityType,
      description,
      metadata: sanitizeMetadata(input.metadata),
      company_id: links.companyId,
      contact_id: links.contactId,
      opportunity_id: links.opportunityId,
      quote_id: links.quoteId,
      task_id: links.taskId,
      actor_profile_id: input.actorProfileId ?? null,
    })
    .select("id")
    .single();

  if (error || !activity) {
    if (process.env.NODE_ENV === "development") {
      console.error("[crm activity] insert failed:", error?.message ?? "Unknown error");
    }

    throw new Error(error?.message ?? "Unable to create CRM activity.");
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[crm activity] inserted activity id:", activity.id);
  }

  return activity.id;
}
