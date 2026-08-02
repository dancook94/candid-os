import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
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
    .select("id, company_id, profile_id")
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

  return NextResponse.json({
    success: true,
    message: "Contact updated.",
  });
}
