import { NextResponse } from "next/server";

import {
  assertConcurrency,
  assertContactOwnership,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/customer-settings/activity";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import { commitCustomerSettingsChange } from "@/lib/customer-settings/save-with-activity";
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
    const contactSnapshot = {
      full_name: context.contact.full_name,
      job_title: context.contact.job_title,
      phone: context.contact.phone,
      updated_at: context.contact.updated_at,
    };
    const profileNameSnapshot = context.profile.full_name;
    const syncProfileName = changedFields.includes("full_name");

    await commitCustomerSettingsChange({
      context,
      devOperationLabel: "profile.update",
      operation: async () => {
        const { error: contactError } = await adminClient
          .from("contacts")
          .update(updates)
          .eq("id", context.contact!.id)
          .eq("company_id", context.company.id);

        if (contactError) {
          throw new CustomerSettingsError(contactError.message, 400);
        }

        if (syncProfileName && typeof updates.full_name === "string") {
          const { error: profileError } = await adminClient
            .from("profiles")
            .update({
              full_name: updates.full_name,
              updated_at: new Date().toISOString(),
            })
            .eq("id", user.id);

          if (profileError) {
            throw new CustomerSettingsError(profileError.message, 400);
          }
        }
      },
      rollback: async () => {
        await adminClient
          .from("contacts")
          .update(contactSnapshot)
          .eq("id", context.contact!.id)
          .eq("company_id", context.company.id);

        if (syncProfileName) {
          await adminClient
            .from("profiles")
            .update({
              full_name: profileNameSnapshot,
              updated_at: context.profile.updated_at,
            })
            .eq("id", user.id);
        }
      },
      activity: {
        activityType: CRM_ACTIVITY_TYPES.customerContactUpdated,
        description: `${context.contact.full_name} updated their contact details in the customer portal.`,
        changedFields,
        contactId: context.contact.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Profile updated.",
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
