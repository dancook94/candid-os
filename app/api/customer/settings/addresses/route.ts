import { NextResponse } from "next/server";

import {
  assertCompanyOwnership,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/customer-settings/activity";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { CustomerSettingsError, isMissingRelationError } from "@/lib/customer-settings/errors";
import { commitCustomerSettingsChange } from "@/lib/customer-settings/save-with-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type CreateAddressBody = {
  label?: string | null;
  recipientName?: string | null;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string;
  country?: string | null;
  phone?: string | null;
  deliveryInstructions?: string | null;
  isDefaultDelivery?: boolean;
  isDefaultBilling?: boolean;
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);
    assertCompanyOwnership(context, context.company.id);

    let body: CreateAddressBody;

    try {
      body = (await request.json()) as CreateAddressBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const addressLine1 = body.addressLine1?.trim() ?? "";
    const postcode = body.postcode?.trim() ?? "";

    if (!addressLine1) {
      return NextResponse.json(
        { error: "Address line 1 is required." },
        { status: 400 }
      );
    }

    if (!postcode) {
      return NextResponse.json({ error: "Postcode is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const now = new Date().toISOString();
    let createdAddressId: string | null = null;

    const result = await commitCustomerSettingsChange({
      context,
      devOperationLabel: "address.create",
      operation: async () => {
        if (body.isDefaultDelivery) {
          await adminClient
            .from("company_addresses")
            .update({ is_default_delivery: false, updated_at: now })
            .eq("company_id", context.company.id)
            .eq("is_default_delivery", true);
        }

        if (body.isDefaultBilling) {
          await adminClient
            .from("company_addresses")
            .update({ is_default_billing: false, updated_at: now })
            .eq("company_id", context.company.id)
            .eq("is_default_billing", true);
        }

        const { data: created, error } = await adminClient
          .from("company_addresses")
          .insert({
            company_id: context.company.id,
            label: body.label?.trim() || null,
            recipient_name: body.recipientName?.trim() || null,
            address_line_1: addressLine1,
            address_line_2: body.addressLine2?.trim() || null,
            city: body.city?.trim() || null,
            county: body.county?.trim() || null,
            postcode,
            country: body.country?.trim() || "GB",
            phone: body.phone?.trim() || null,
            delivery_instructions: body.deliveryInstructions?.trim() || null,
            is_default_delivery: Boolean(body.isDefaultDelivery),
            is_default_billing: Boolean(body.isDefaultBilling),
            is_active: true,
            created_by: user.id,
            created_at: now,
            updated_at: now,
          })
          .select("id")
          .single();

        if (error) {
          if (isMissingRelationError(error)) {
            throw new CustomerSettingsError(
              "Saved addresses require the customer settings database migration.",
              501
            );
          }

          throw new CustomerSettingsError(error.message, 400);
        }

        createdAddressId = created?.id ?? null;
        return createdAddressId;
      },
      rollback: async () => {
        if (!createdAddressId) {
          return;
        }

        await adminClient
          .from("company_addresses")
          .delete()
          .eq("id", createdAddressId)
          .eq("company_id", context.company.id);
      },
      activity: (addressId) => ({
        activityType: CRM_ACTIVITY_TYPES.companyAddressCreated,
        description: `A saved address was added for ${context.company.company_name}.`,
        changedFields: ["company_address"],
        addressId,
      }),
    });

    return NextResponse.json({
      success: true,
      message: "Address saved.",
      id: result,
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
