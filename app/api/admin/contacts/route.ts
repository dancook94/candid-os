import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  findDuplicateContactEmail,
  normalizeContactEmail,
} from "@/lib/crm/contacts";
import { createClient } from "@/lib/supabase/server";

type CreateContactBody = {
  companyId?: string;
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: CreateContactBody;

  try {
    body = (await request.json()) as CreateContactBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const companyId = body.companyId?.trim() ?? "";
  const fullName = body.fullName?.trim() ?? "";
  const email = normalizeContactEmail(body.email ?? null);

  if (!companyId) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  if (!fullName) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError || !company) {
    return NextResponse.json(
      { error: companyError?.message ?? "Company not found." },
      { status: 400 }
    );
  }

  if (email) {
    const duplicate = await findDuplicateContactEmail(
      supabase,
      companyId,
      email
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

  const { data: created, error: insertError } = await supabase
    .from("contacts")
    .insert({
      company_id: companyId,
      full_name: fullName,
      email,
      phone: body.phone?.trim() || null,
      job_title: body.jobTitle?.trim() || null,
      notes: body.notes?.trim() || null,
      is_primary: body.isPrimary ?? false,
      is_active: body.isActive ?? true,
      created_by: authResult.userId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? "Unable to create contact." },
      { status: 400 }
    );
  }

  await createCrmActivity(supabase, {
    companyId,
    contactId: created.id,
    activityType: CRM_ACTIVITY_TYPES.contactCreated,
    description: `${fullName} was added as a contact.`,
    metadata: { contact_id: created.id },
    actorProfileId: authResult.userId,
  });

  if (body.isPrimary) {
    await createCrmActivity(supabase, {
      companyId,
      contactId: created.id,
      activityType: CRM_ACTIVITY_TYPES.contactSetPrimary,
      description: `${fullName} was set as the primary contact.`,
      metadata: { contact_id: created.id },
      actorProfileId: authResult.userId,
    });
  }

  return NextResponse.json({
    success: true,
    id: created.id,
    message: `${fullName} added as a contact.`,
  });
}
