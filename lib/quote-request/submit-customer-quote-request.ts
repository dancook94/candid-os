import type { SupabaseClient } from "@supabase/supabase-js";

import type { CustomerQuoteRequestContext } from "@/lib/customer-settings/auth";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import { isMissingRelationError } from "@/lib/customer-settings/errors";
import { loadCompanyAddresses } from "@/lib/customer-settings/addresses";
import { CRM_ACTIVITY_TYPES, logQuoteRequestCustomerActivity } from "@/lib/quote-request/activity";
import { createOpportunityFromQuoteRequest } from "@/lib/crm/opportunity-linking";
import {
  buildAddressDuplicateKey,
  isValidUkPostcode,
  snapshotFromCompanyAddress,
  type DeliveryAddressSnapshot,
} from "@/lib/quote-request/normalize-address";
import type {
  DeliveryAddressSource,
  SubmitCustomerQuoteRequestBody,
} from "@/lib/quote-request/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const QUOTE_REQUEST_SUBMIT_ERROR =
  "Your quote request could not be submitted. Please try again.";

export type SubmitCustomerQuoteRequestResult = {
  quoteRequestId: string;
  addressReused?: boolean;
  addressSaved?: boolean;
};

function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isMissingColumnError(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST204" ||
    Boolean(
      error.message?.includes("column") &&
        error.message.includes("does not exist")
    )
  );
}

async function findDuplicateCompanyAddress(
  adminClient: SupabaseClient,
  companyId: string,
  snapshot: DeliveryAddressSnapshot
) {
  const { data, error } = await adminClient
    .from("company_addresses")
    .select(
      "id, address_line_1, address_line_2, postcode, country, is_active"
    )
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }

    throw new CustomerSettingsError(error.message, 500);
  }

  const targetKey = buildAddressDuplicateKey({
    addressLine1: snapshot.addressLine1,
    addressLine2: snapshot.addressLine2,
    postcode: snapshot.postcode,
    country: snapshot.country,
  });

  return (
    (data ?? []).find(
      (row) =>
        buildAddressDuplicateKey({
          addressLine1: row.address_line_1,
          addressLine2: row.address_line_2,
          postcode: row.postcode,
          country: row.country,
        }) === targetKey
    ) ?? null
  );
}

async function resolveDeliverySnapshot(
  adminClient: SupabaseClient,
  context: CustomerQuoteRequestContext,
  body: SubmitCustomerQuoteRequestBody
): Promise<{
  snapshot: DeliveryAddressSnapshot;
  source: DeliveryAddressSource;
  selectedAddressId: string | null;
  saveForFuture: boolean;
}> {
  if (!body.delivery) {
    throw new CustomerSettingsError("Delivery address is required.", 400);
  }

  if (body.delivery.mode === "saved") {
    const { data: address, error } = await adminClient
      .from("company_addresses")
      .select(
        "id, company_id, label, recipient_name, address_line_1, address_line_2, city, county, postcode, country, phone, delivery_instructions, is_active"
      )
      .eq("id", body.delivery.savedAddressId)
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error)) {
        throw new CustomerSettingsError(
          "Saved addresses require the customer settings database migration.",
          501
        );
      }

      throw new CustomerSettingsError(error.message, 500);
    }

    if (
      !address ||
      address.company_id !== context.company.id ||
      !address.is_active
    ) {
      throw new CustomerSettingsError(
        "The selected saved address is no longer available.",
        409
      );
    }

    return {
      snapshot: snapshotFromCompanyAddress(
        address,
        context.company.trading_name || context.company.company_name
      ),
      source: "saved",
      selectedAddressId: address.id,
      saveForFuture: false,
    };
  }

  const recipientName = body.delivery.recipientName.trim();
  const addressLine1 = body.delivery.addressLine1.trim();
  const city = body.delivery.city.trim();
  const postcode = body.delivery.postcode.trim();
  const country = body.delivery.country.trim() || "GB";

  if (!recipientName) {
    throw new CustomerSettingsError("Recipient name is required.", 400);
  }

  if (!addressLine1) {
    throw new CustomerSettingsError("Address line 1 is required.", 400);
  }

  if (!city) {
    throw new CustomerSettingsError("City/town is required.", 400);
  }

  if (!postcode) {
    throw new CustomerSettingsError("Postcode is required.", 400);
  }

  if (country.toUpperCase() === "GB" && !isValidUkPostcode(postcode)) {
    throw new CustomerSettingsError("Enter a valid UK postcode.", 400);
  }

  const snapshot: DeliveryAddressSnapshot = {
    label: body.delivery.label?.trim() || null,
    recipientName,
    addressLine1,
    addressLine2: body.delivery.addressLine2?.trim() || null,
    city,
    county: body.delivery.county?.trim() || null,
    postcode,
    country,
    phone: body.delivery.phone?.trim() || null,
    deliveryInstructions: body.delivery.deliveryInstructions?.trim() || null,
  };

  return {
    snapshot,
    source: body.delivery.saveForFuture ? "new_saved" : "new",
    selectedAddressId: null,
    saveForFuture: body.delivery.saveForFuture,
  };
}

function buildQuoteRequestInsert(
  context: CustomerQuoteRequestContext,
  body: SubmitCustomerQuoteRequestBody,
  defaultDeadlineStatus: string,
  delivery:
    | {
        snapshot: DeliveryAddressSnapshot;
        source: DeliveryAddressSource;
        selectedAddressId: string | null;
      }
    | null
) {
  const isDelivery = body.fulfilmentMethod === "delivery";

  return {
    company_id: context.company.id,
    contact_id: context.contact.id,
    requested_by: context.profile.id,
    project_name: body.projectName.trim(),
    description: body.description.trim(),
    fulfilment_method: body.fulfilmentMethod,
    requested_date: body.requestedDate,
    requested_time: body.requestedTime?.trim() || null,
    delivery_address_line_1: isDelivery ? delivery!.snapshot.addressLine1 : null,
    delivery_address_line_2: isDelivery ? delivery!.snapshot.addressLine2 : null,
    delivery_city: isDelivery ? delivery!.snapshot.city : null,
    delivery_county: isDelivery ? delivery!.snapshot.county : null,
    delivery_postcode: isDelivery ? delivery!.snapshot.postcode : null,
    delivery_contact_name: isDelivery ? delivery!.snapshot.recipientName : null,
    delivery_contact_phone: isDelivery ? delivery!.snapshot.phone : null,
    delivery_country: isDelivery ? delivery!.snapshot.country : null,
    delivery_instructions: isDelivery
      ? delivery!.snapshot.deliveryInstructions
      : null,
    delivery_address_label: isDelivery ? delivery!.snapshot.label : null,
    selected_company_address_id: isDelivery
      ? delivery!.selectedAddressId
      : null,
    delivery_address_source: isDelivery ? delivery!.source : null,
    purchase_order_number: body.purchaseOrderNumber?.trim() || null,
    notes: body.notes?.trim() || null,
    deadline_status: defaultDeadlineStatus,
    request_status: "submitted" as const,
  };
}

async function insertQuoteRequest(
  adminClient: SupabaseClient,
  payload: ReturnType<typeof buildQuoteRequestInsert>
) {
  const { data, error } = await adminClient
    .from("quote_requests")
    .insert(payload)
    .select("id")
    .single();

  if (!error && data) {
    return data.id;
  }

  if (error && isMissingColumnError(error)) {
    const {
      contact_id: _contactId,
      delivery_country: _country,
      delivery_instructions: _instructions,
      delivery_address_label: _label,
      selected_company_address_id: _selectedId,
      delivery_address_source: _source,
      ...legacyPayload
    } = payload;

    const { data: fallbackData, error: fallbackError } = await adminClient
      .from("quote_requests")
      .insert(legacyPayload)
      .select("id")
      .single();

    if (fallbackError || !fallbackData) {
      throw new CustomerSettingsError(
        fallbackError?.message ?? QUOTE_REQUEST_SUBMIT_ERROR,
        400
      );
    }

    return fallbackData.id;
  }

  throw new CustomerSettingsError(error?.message ?? QUOTE_REQUEST_SUBMIT_ERROR, 400);
}

export async function submitCustomerQuoteRequest(
  context: CustomerQuoteRequestContext,
  body: SubmitCustomerQuoteRequestBody,
  defaultDeadlineStatus: string
): Promise<SubmitCustomerQuoteRequestResult> {
  if (!body.projectName.trim()) {
    throw new CustomerSettingsError("Project name is required.", 400);
  }

  if (!body.description.trim()) {
    throw new CustomerSettingsError("Project description is required.", 400);
  }

  if (!body.requestedDate) {
    throw new CustomerSettingsError("Required date is required.", 400);
  }

  if (body.requestedDate < getTodayString()) {
    throw new CustomerSettingsError("Required date cannot be in the past.", 400);
  }

  const adminClient = createAdminClient();
  let createdAddressId: string | null = null;
  let addressWasNewlyCreated = false;
  let addressReused = false;

  const delivery =
    body.fulfilmentMethod === "delivery"
      ? await resolveDeliverySnapshot(adminClient, context, body)
      : null;

  if (delivery?.saveForFuture) {
    const duplicate = await findDuplicateCompanyAddress(
      adminClient,
      context.company.id,
      delivery.snapshot
    );

    if (duplicate) {
      delivery.selectedAddressId = duplicate.id;
      delivery.source = "saved";
      addressReused = true;
    } else {
      const now = new Date().toISOString();
      const { data: createdAddress, error: addressError } = await adminClient
        .from("company_addresses")
        .insert({
          company_id: context.company.id,
          label:
            delivery.snapshot.label?.trim() || "New delivery address",
          recipient_name: delivery.snapshot.recipientName,
          address_line_1: delivery.snapshot.addressLine1,
          address_line_2: delivery.snapshot.addressLine2,
          city: delivery.snapshot.city,
          county: delivery.snapshot.county,
          postcode: delivery.snapshot.postcode,
          country: delivery.snapshot.country,
          phone: delivery.snapshot.phone,
          delivery_instructions: delivery.snapshot.deliveryInstructions,
          is_default_delivery: false,
          is_default_billing: false,
          is_active: true,
          created_by: context.user.id,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (addressError) {
        if (isMissingRelationError(addressError)) {
          throw new CustomerSettingsError(
            "Saving addresses requires the customer settings database migration.",
            501
          );
        }

        throw new CustomerSettingsError(
          "Unable to save the delivery address. The quote request was not submitted.",
          400
        );
      }

      createdAddressId = createdAddress?.id ?? null;
      addressWasNewlyCreated = true;
      delivery.selectedAddressId = createdAddressId;
      delivery.source = "new_saved";
    }
  }

  let quoteRequestId: string | undefined;

  try {
    const createdQuoteRequestId = await insertQuoteRequest(
      adminClient,
      buildQuoteRequestInsert(context, body, defaultDeadlineStatus, delivery)
    );
    quoteRequestId = createdQuoteRequestId;

    await logQuoteRequestCustomerActivity(context, {
      activityType: CRM_ACTIVITY_TYPES.quoteRequestCreated,
      description: `${context.company.company_name} submitted a quote request for ${body.projectName.trim()}.`,
      quoteRequestId: createdQuoteRequestId,
      metadata: {
        changed_fields: ["quote_request"],
        fulfilment_method: body.fulfilmentMethod,
        delivery_address_source: delivery?.source ?? null,
      },
    });

    await createOpportunityFromQuoteRequest(adminClient, {
      quoteRequestId: createdQuoteRequestId,
      actorProfileId: context.profile.id,
      contactId: context.contact.id,
    });

    if (addressWasNewlyCreated && createdAddressId) {
      await logQuoteRequestCustomerActivity(context, {
        activityType: CRM_ACTIVITY_TYPES.companyAddressCreated,
        description: `A saved address was added for ${context.company.company_name} during quote request submission.`,
        quoteRequestId: createdQuoteRequestId,
        addressId: createdAddressId,
        metadata: {
          changed_fields: ["company_address"],
        },
      });
    }

    return {
      quoteRequestId: createdQuoteRequestId,
      addressReused,
      addressSaved: addressWasNewlyCreated,
    };
  } catch (error) {
    if (quoteRequestId) {
      await adminClient.from("quote_requests").delete().eq("id", quoteRequestId);
    }

    if (addressWasNewlyCreated && createdAddressId) {
      await adminClient
        .from("company_addresses")
        .delete()
        .eq("id", createdAddressId)
        .eq("company_id", context.company.id);
    }

    if (error instanceof CustomerSettingsError) {
      throw error;
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[quote request] submit failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    throw new CustomerSettingsError(QUOTE_REQUEST_SUBMIT_ERROR, 500);
  }
}

export async function loadQuoteRequestSavedAddresses(
  adminClient: SupabaseClient,
  companyId: string
) {
  const feature = await loadCompanyAddresses(adminClient, companyId);

  const addresses = [...feature.addresses].sort((left, right) => {
    if (left.is_default_delivery !== right.is_default_delivery) {
      return left.is_default_delivery ? -1 : 1;
    }

    return (left.label ?? "").localeCompare(right.label ?? "");
  });

  return {
    available: feature.available,
    addresses,
  };
}
