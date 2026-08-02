import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isMissingColumnError,
  isMissingRelationError,
} from "@/lib/customer-settings/query-errors";
import type { QuoteRequestAttachmentRecord } from "@/lib/quote-request-attachments";

export const QUOTE_REQUEST_CORE_SELECT =
  "id, company_id, requested_by, project_name, description, fulfilment_method, requested_date, requested_time, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, delivery_contact_name, delivery_contact_phone, purchase_order_number, notes, deadline_status, request_status, created_at";

const QUOTE_REQUEST_ADDRESS_METADATA_SELECT =
  "delivery_country, delivery_instructions, delivery_address_label, selected_company_address_id, delivery_address_source";

export type AdminQuoteRequestDetail = {
  id: string;
  company_id: string;
  requested_by: string;
  project_name: string;
  description: string;
  fulfilment_method: string;
  requested_date: string;
  requested_time: string | null;
  delivery_address_line_1: string | null;
  delivery_address_line_2: string | null;
  delivery_city: string | null;
  delivery_county: string | null;
  delivery_postcode: string | null;
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  delivery_country: string | null;
  delivery_instructions: string | null;
  delivery_address_label: string | null;
  selected_company_address_id: string | null;
  delivery_address_source: string | null;
  purchase_order_number: string | null;
  notes: string | null;
  deadline_status: string;
  request_status: string;
  created_at: string;
};

export type AdminQuoteRequestRelatedData = {
  company: { company_name: string } | null;
  companyWarning: string | null;
  requester: { full_name: string | null } | null;
  requesterWarning: string | null;
  attachments: QuoteRequestAttachmentRecord[];
  attachmentsWarning: string | null;
  linkedQuote: { id: string; status: string; quote_number: number } | null;
  linkedQuoteWarning: string | null;
  linkedAddress: { id: string; label: string | null; is_active: boolean } | null;
  linkedAddressWarning: string | null;
};

export type LoadAdminQuoteRequestDetailResult =
  | {
      kind: "found";
      quoteRequest: AdminQuoteRequestDetail;
      related: AdminQuoteRequestRelatedData;
      warnings: string[];
    }
  | { kind: "not_found" }
  | { kind: "core_error"; message: string; devMessage: string | null };

type SupabaseQueryError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function logAdminQuoteRequestQueryError(
  query:
    | "core request"
    | "address metadata"
    | "company"
    | "contact"
    | "requester"
    | "attachments"
    | "linked quote"
    | "saved address",
  error: SupabaseQueryError
) {
  console.error("[admin quote request] query failed", {
    query,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

function emptyAddressMetadata() {
  return {
    delivery_country: null,
    delivery_instructions: null,
    delivery_address_label: null,
    selected_company_address_id: null,
    delivery_address_source: null,
  };
}

async function loadAddressMetadata(
  supabase: SupabaseClient,
  routeId: string
): Promise<{
  metadata: ReturnType<typeof emptyAddressMetadata>;
  warning: string | null;
}> {
  const { data, error } = await supabase
    .from("quote_requests")
    .select(QUOTE_REQUEST_ADDRESS_METADATA_SELECT)
    .eq("id", routeId)
    .maybeSingle();

  if (!error && data) {
    return {
      metadata: {
        delivery_country: data.delivery_country ?? null,
        delivery_instructions: data.delivery_instructions ?? null,
        delivery_address_label: data.delivery_address_label ?? null,
        selected_company_address_id: data.selected_company_address_id ?? null,
        delivery_address_source: data.delivery_address_source ?? null,
      },
      warning: null,
    };
  }

  if (error) {
    logAdminQuoteRequestQueryError("address metadata", error);

    if (isMissingColumnError(error)) {
      return {
        metadata: emptyAddressMetadata(),
        warning:
          "Extended delivery address metadata is unavailable. Apply docs/proposed-quote-request-address-migration.sql to enable saved-address traceability fields.",
      };
    }
  }

  return {
    metadata: emptyAddressMetadata(),
    warning: "Extended delivery address metadata could not be loaded.",
  };
}

export async function loadAdminQuoteRequestDetail(
  supabase: SupabaseClient,
  routeId: string
): Promise<LoadAdminQuoteRequestDetailResult> {
  if (process.env.NODE_ENV === "development") {
    console.log("[admin quote request] loading", {
      routeId,
    });
  }

  const { data: coreRequest, error: coreError } = await supabase
    .from("quote_requests")
    .select(QUOTE_REQUEST_CORE_SELECT)
    .eq("id", routeId)
    .maybeSingle();

  if (coreError) {
    logAdminQuoteRequestQueryError("core request", coreError);

    return {
      kind: "core_error",
      message: "Quote request could not be loaded.",
      devMessage:
        process.env.NODE_ENV === "development" ? coreError.message ?? null : null,
    };
  }

  if (!coreRequest) {
    return { kind: "not_found" };
  }

  const warnings: string[] = [];
  const { metadata, warning: metadataWarning } = await loadAddressMetadata(
    supabase,
    routeId
  );

  if (metadataWarning) {
    warnings.push(metadataWarning);
  }

  const quoteRequest: AdminQuoteRequestDetail = {
    ...coreRequest,
    ...metadata,
  };

  const related: AdminQuoteRequestRelatedData = {
    company: null,
    companyWarning: null,
    requester: null,
    requesterWarning: null,
    attachments: [],
    attachmentsWarning: null,
    linkedQuote: null,
    linkedQuoteWarning: null,
    linkedAddress: null,
    linkedAddressWarning: null,
  };

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("company_name")
    .eq("id", quoteRequest.company_id)
    .maybeSingle();

  if (companyError) {
    logAdminQuoteRequestQueryError("company", companyError);
    related.companyWarning = "Company details could not be loaded.";
  } else {
    related.company = company;
  }

  const { data: requester, error: requesterError } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", quoteRequest.requested_by)
    .maybeSingle();

  if (requesterError) {
    logAdminQuoteRequestQueryError("requester", requesterError);
    related.requesterWarning = "Requester details could not be loaded.";
  } else {
    related.requester = requester;
  }

  const { data: attachments, error: attachmentsError } = await supabase
    .from("quote_request_attachments")
    .select("id, file_name, file_size, file_type, storage_path, created_at")
    .eq("quote_request_id", routeId)
    .order("created_at", { ascending: false });

  if (attachmentsError) {
    logAdminQuoteRequestQueryError("attachments", attachmentsError);

    if (isMissingRelationError(attachmentsError)) {
      related.attachmentsWarning =
        "Attachments could not be loaded because quote_request_attachments is unavailable.";
    } else {
      related.attachmentsWarning = "Attachments could not be loaded.";
    }
  } else {
    related.attachments = attachments ?? [];
  }

  const { data: linkedQuote, error: linkedQuoteError } = await supabase
    .from("quotes")
    .select("id, status, quote_number")
    .eq("quote_request_id", routeId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkedQuoteError) {
    logAdminQuoteRequestQueryError("linked quote", linkedQuoteError);
    related.linkedQuoteWarning = "Linked quote details could not be loaded.";
  } else {
    related.linkedQuote = linkedQuote;
  }

  if (quoteRequest.selected_company_address_id) {
    const { data: linkedAddress, error: linkedAddressError } = await supabase
      .from("company_addresses")
      .select("id, label, is_active")
      .eq("id", quoteRequest.selected_company_address_id)
      .maybeSingle();

    if (linkedAddressError) {
      logAdminQuoteRequestQueryError("saved address", linkedAddressError);

      if (isMissingRelationError(linkedAddressError)) {
        related.linkedAddressWarning =
          "Saved address link is unavailable. Apply docs/proposed-customer-settings-migration.sql to enable company_addresses.";
      } else {
        related.linkedAddressWarning =
          "Saved address link could not be loaded. The submitted address snapshot below remains authoritative.";
      }
    } else {
      related.linkedAddress = linkedAddress;
    }
  }

  return {
    kind: "found",
    quoteRequest,
    related,
    warnings,
  };
}
