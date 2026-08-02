import { NextResponse } from "next/server";

import {
  assertCompanyOwnership,
  assertConcurrency,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/customer-settings/activity";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { CustomerSettingsError, isMissingRelationError } from "@/lib/customer-settings/errors";
import { commitCustomerSettingsChange } from "@/lib/customer-settings/save-with-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type UpdateAddressBody = {
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
  isActive?: boolean;
  updatedAt?: string | null;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ADDRESS_SNAPSHOT_SELECT =
  "id, company_id, label, recipient_name, address_line_1, address_line_2, city, county, postcode, country, phone, delivery_instructions, is_default_delivery, is_default_billing, is_active, updated_at";

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);
    assertCompanyOwnership(context, context.company.id);

    const adminClient = createAdminClient();

    const { data: existing, error: existingError } = await adminClient
      .from("company_addresses")
      .select(ADDRESS_SNAPSHOT_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      if (isMissingRelationError(existingError)) {
        return NextResponse.json(
          {
            error:
              "Saved addresses require the customer settings database migration.",
          },
          { status: 501 }
        );
      }

      throw new CustomerSettingsError(existingError.message, 500);
    }

    if (!existing || existing.company_id !== context.company.id) {
      return NextResponse.json({ error: "Address not found." }, { status: 404 });
    }

    let body: UpdateAddressBody;

    try {
      body = (await request.json()) as UpdateAddressBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    assertConcurrency(existing.updated_at, body.updatedAt ?? null);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const changedFields: string[] = [];

    if (body.label !== undefined) {
      updates.label = body.label?.trim() || null;
      changedFields.push("label");
    }

    if (body.recipientName !== undefined) {
      updates.recipient_name = body.recipientName?.trim() || null;
      changedFields.push("recipient_name");
    }

    if (body.addressLine1 !== undefined) {
      const value = body.addressLine1.trim();

      if (!value) {
        return NextResponse.json(
          { error: "Address line 1 is required." },
          { status: 400 }
        );
      }

      updates.address_line_1 = value;
      changedFields.push("address_line_1");
    }

    if (body.addressLine2 !== undefined) {
      updates.address_line_2 = body.addressLine2?.trim() || null;
      changedFields.push("address_line_2");
    }

    if (body.city !== undefined) {
      updates.city = body.city?.trim() || null;
      changedFields.push("city");
    }

    if (body.county !== undefined) {
      updates.county = body.county?.trim() || null;
      changedFields.push("county");
    }

    if (body.postcode !== undefined) {
      const value = body.postcode.trim();

      if (!value) {
        return NextResponse.json({ error: "Postcode is required." }, { status: 400 });
      }

      updates.postcode = value;
      changedFields.push("postcode");
    }

    if (body.country !== undefined) {
      updates.country = body.country?.trim() || "GB";
      changedFields.push("country");
    }

    if (body.phone !== undefined) {
      updates.phone = body.phone?.trim() || null;
      changedFields.push("phone");
    }

    if (body.deliveryInstructions !== undefined) {
      updates.delivery_instructions = body.deliveryInstructions?.trim() || null;
      changedFields.push("delivery_instructions");
    }

    if (body.isDefaultDelivery === true) {
      await adminClient
        .from("company_addresses")
        .update({
          is_default_delivery: false,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", context.company.id)
        .eq("is_default_delivery", true);

      updates.is_default_delivery = true;
      changedFields.push("is_default_delivery");
    }

    if (body.isDefaultBilling === true) {
      await adminClient
        .from("company_addresses")
        .update({
          is_default_billing: false,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", context.company.id)
        .eq("is_default_billing", true);

      updates.is_default_billing = true;
      changedFields.push("is_default_billing");
    }

    if (body.isActive === false && existing.is_active) {
      updates.is_active = false;
      changedFields.push("is_active");
    }

    if (changedFields.length === 0) {
      return NextResponse.json({ error: "No changes to save." }, { status: 400 });
    }

    const addressSnapshot = { ...existing };
    const isDeactivation = body.isActive === false;

    await commitCustomerSettingsChange({
      context,
      devOperationLabel: isDeactivation ? "address.deactivate" : "address.update",
      operation: async () => {
        const { error } = await adminClient
          .from("company_addresses")
          .update(updates)
          .eq("id", id)
          .eq("company_id", context.company.id);

        if (error) {
          throw new CustomerSettingsError(error.message, 400);
        }
      },
      rollback: async () => {
        await adminClient
          .from("company_addresses")
          .update({
            label: addressSnapshot.label,
            recipient_name: addressSnapshot.recipient_name,
            address_line_1: addressSnapshot.address_line_1,
            address_line_2: addressSnapshot.address_line_2,
            city: addressSnapshot.city,
            county: addressSnapshot.county,
            postcode: addressSnapshot.postcode,
            country: addressSnapshot.country,
            phone: addressSnapshot.phone,
            delivery_instructions: addressSnapshot.delivery_instructions,
            is_default_delivery: addressSnapshot.is_default_delivery,
            is_default_billing: addressSnapshot.is_default_billing,
            is_active: addressSnapshot.is_active,
            updated_at: addressSnapshot.updated_at,
          })
          .eq("id", id)
          .eq("company_id", context.company.id);
      },
      activity: {
        activityType: isDeactivation
          ? CRM_ACTIVITY_TYPES.companyAddressDeactivated
          : CRM_ACTIVITY_TYPES.companyAddressUpdated,
        description: isDeactivation
          ? `A saved address was deactivated for ${context.company.company_name}.`
          : `A saved address was updated for ${context.company.company_name}.`,
        changedFields,
        addressId: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: isDeactivation ? "Address removed." : "Address updated.",
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);
    assertCompanyOwnership(context, context.company.id);

    const adminClient = createAdminClient();

    const { data: existing, error: existingError } = await adminClient
      .from("company_addresses")
      .select("id, company_id, is_active, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      if (isMissingRelationError(existingError)) {
        return NextResponse.json(
          {
            error:
              "Saved addresses require the customer settings database migration.",
          },
          { status: 501 }
        );
      }

      throw new CustomerSettingsError(existingError.message, 500);
    }

    if (!existing || existing.company_id !== context.company.id) {
      return NextResponse.json({ error: "Address not found." }, { status: 404 });
    }

    const addressSnapshot = { ...existing };

    await commitCustomerSettingsChange({
      context,
      devOperationLabel: "address.deactivate",
      operation: async () => {
        const { error } = await adminClient
          .from("company_addresses")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("company_id", context.company.id);

        if (error) {
          throw new CustomerSettingsError(error.message, 400);
        }
      },
      rollback: async () => {
        await adminClient
          .from("company_addresses")
          .update({
            is_active: addressSnapshot.is_active,
            updated_at: addressSnapshot.updated_at,
          })
          .eq("id", id)
          .eq("company_id", context.company.id);
      },
      activity: {
        activityType: CRM_ACTIVITY_TYPES.companyAddressDeactivated,
        description: `A saved address was deactivated for ${context.company.company_name}.`,
        changedFields: ["is_active"],
        addressId: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Address removed.",
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
