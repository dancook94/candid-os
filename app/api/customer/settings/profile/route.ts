import { NextResponse } from "next/server";

import {
  assertConcurrency,
  assertContactOwnership,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import {
  CRM_ACTIVITY_TYPES,
  logCustomerSettingsActivity,
} from "@/lib/customer-settings/activity";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type UpdateProfileBody = {
  fullName?: string;
  jobTitle?: string | null;
  phone?: string | null;
  updatedAt?: string | null;
};

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);

    if (!context.contact) {
      return NextResponse.json(
        {
          error:
            "Your portal account is not linked to a CRM contact. Contact Candid Creative for assistance.",
        },
        { status: 409 }
      );
    }

    assertContactOwnership(context, context.contact.id);

    let body: UpdateProfileBody;

    try {
      body = (await request.json()) as UpdateProfileBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    assertConcurrency(context.contact.updated_at, body.updatedAt ?? null);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const changedFields: string[] = [];

    if (body.fullName !== undefined) {
      const fullName = body.fullName.trim();

      if (!fullName) {
        return NextResponse.json(
          { error: "Full name is required." },
          { status: 400 }
        );
      }

      updates.full_name = fullName;
      changedFields.push("full_name");
    }

    if (body.jobTitle !== undefined) {
      updates.job_title = body.jobTitle?.trim() || null;
      changedFields.push("job_title");
    }

    if (body.phone !== undefined) {
      updates.phone = body.phone?.trim() || null;
      changedFields.push("phone");
    }

    if (changedFields.length === 0) {
      return NextResponse.json({ error: "No changes to save." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { error: contactError } = await adminClient
      .from("contacts")
      .update(updates)
      .eq("id", context.contact.id)
      .eq("company_id", context.company.id);

    if (contactError) {
      return NextResponse.json({ error: contactError.message }, { status: 400 });
    }

    if (changedFields.includes("full_name") && typeof updates.full_name === "string") {
      await adminClient
        .from("profiles")
        .update({
          full_name: updates.full_name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    }

    await logCustomerSettingsActivity(supabase, context, {
      activityType: CRM_ACTIVITY_TYPES.customerContactUpdated,
      description: `${context.contact.full_name} updated their contact details in the customer portal.`,
      changedFields,
      contactId: context.contact.id,
    });

    return NextResponse.json({
      success: true,
      message: "Profile updated.",
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
