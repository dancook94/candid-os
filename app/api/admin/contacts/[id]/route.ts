import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  findDuplicateContactEmail,
  normalizeContactEmail,
} from "@/lib/crm/contacts";
import { createClient } from "@/lib/supabase/server";

type UpdateContactBody = {
  companyId?: string;
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: UpdateContactBody;

  try {
    body = (await request.json()) as UpdateContactBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("contacts")
    .select("id, company_id, profile_id, full_name, is_primary, is_active")
    .eq("id", id)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json(
      { error: existingError?.message ?? "Contact not found." },
      { status: 404 }
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.fullName !== undefined) {
    const fullName = body.fullName.trim();

    if (!fullName) {
      return NextResponse.json(
        { error: "Full name is required." },
        { status: 400 }
      );
    }

    updates.full_name = fullName;
  }

  if (body.email !== undefined) {
    const email = normalizeContactEmail(body.email);

    if (email) {
      const duplicate = await findDuplicateContactEmail(
        supabase,
        existing.company_id,
        email,
        id
      );

      if (duplicate) {
        return NextResponse.json(
          {
            error: `A contact with this email already exists for this company (${duplicate.full_name}).`,
            duplicateContactId: duplicate.id,
          },
          { status: 409 }
        );
      }
    }

    updates.email = email;
  }

  if (body.phone !== undefined) {
    updates.phone = body.phone?.trim() || null;
  }

  if (body.jobTitle !== undefined) {
    updates.job_title = body.jobTitle?.trim() || null;
  }

  if (body.notes !== undefined) {
    updates.notes = body.notes?.trim() || null;
  }

  if (body.isPrimary !== undefined) {
    updates.is_primary = body.isPrimary;
  }

  if (body.isActive !== undefined) {
    updates.is_active = body.isActive;
  }

  if (body.companyId !== undefined && body.companyId !== existing.company_id) {
    if (existing.profile_id) {
      return NextResponse.json(
        {
          error:
            "Cannot change company while contact is linked to a portal user.",
        },
        { status: 400 }
      );
    }

    updates.company_id = body.companyId;
  }

  const { error: updateError } = await supabase
    .from("contacts")
    .update(updates)
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const contactName =
    typeof updates.full_name === "string"
      ? updates.full_name
      : existing.full_name;

  await createCrmActivity(supabase, {
    companyId: existing.company_id,
    contactId: id,
    activityType: CRM_ACTIVITY_TYPES.contactUpdated,
    description: `${contactName} was updated.`,
    metadata: { contact_id: id },
    actorProfileId: authResult.userId,
  });

  if (body.isPrimary === true && !existing.is_primary) {
    await createCrmActivity(supabase, {
      companyId: existing.company_id,
      contactId: id,
      activityType: CRM_ACTIVITY_TYPES.contactSetPrimary,
      description: `${contactName} was set as the primary contact.`,
      metadata: { contact_id: id },
      actorProfileId: authResult.userId,
    });
  }

  if (body.isActive === false && existing.is_active) {
    await createCrmActivity(supabase, {
      companyId: existing.company_id,
      contactId: id,
      activityType: CRM_ACTIVITY_TYPES.contactDeactivated,
      description: `${contactName} was deactivated.`,
      metadata: { contact_id: id },
      actorProfileId: authResult.userId,
    });
  }

  if (body.isActive === true && !existing.is_active) {
    await createCrmActivity(supabase, {
      companyId: existing.company_id,
      contactId: id,
      activityType: CRM_ACTIVITY_TYPES.contactReactivated,
      description: `${contactName} was reactivated.`,
      metadata: { contact_id: id },
      actorProfileId: authResult.userId,
    });
  }

  return NextResponse.json({
    success: true,
    message: "Contact updated.",
  });
}
