import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isMissingColumnError,
  isMissingRelationError,
  isPostgrestSchemaCacheError,
  normalizeSupabaseQueryError,
} from "@/lib/customer-settings/query-errors";
import type { QuoteRequestAttachmentRecord } from "@/lib/quote-request-attachments";
import type { WebsiteArtworkListItem } from "@/components/website-enquiry-artwork";
import {
  buildQuoteRequestDisplayState,
  loadLinkedOpportunity,
  loadLinkedQuoteForRequest,
  type LinkedOpportunitySummary,
  type LinkedQuoteSummary,
  type QuoteRequestQuoteDisplayState,
} from "@/lib/quote-request-link";

/**
 * Core quote_requests columns confirmed on live schema (service-role probe).
 * Snapshot delivery fields live here; optional metadata columns are loaded separately.
 */
export const QUOTE_REQUEST_CORE_SELECT =
  "id, company_id, requested_by, project_name, description, fulfilment_method, requested_date, requested_time, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, delivery_contact_name, delivery_contact_phone, purchase_order_number, notes, deadline_status, request_status, opportunity_id, created_at";

const QUOTE_REQUEST_OPTIONAL_METADATA_COLUMNS = [
  "delivery_country",
  "delivery_instructions",
  "delivery_address_label",
  "selected_company_address_id",
  "delivery_address_source",
] as const;

export type AdminQuoteRequestDetail = {
  id: string;
  company_id: string | null;
  requested_by: string | null;
  project_name: string;
  description: string;
  fulfilment_method: string | null;
  requested_date: string | null;
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
  opportunity_id: string | null;
  created_at: string;
  source: "website" | "customer_portal";
  submitter_name: string | null;
  submitter_company_name: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;
  project_location: string | null;
  existing_job_reference: string | null;
  artwork_pending: boolean;
  suggested_contact_id: string | null;
  suggested_company_id: string | null;
};

export type AdminQuoteRequestRelatedData = {
  company: { company_name: string } | null;
  companyWarning: string | null;
  requester: { full_name: string | null } | null;
  requesterWarning: string | null;
  attachments: QuoteRequestAttachmentRecord[];
  attachmentsWarning: string | null;
  dropboxFiles: WebsiteArtworkListItem[];
  dropboxFilesWarning: string | null;
  linkedQuote: LinkedQuoteSummary | null;
  linkedOpportunity: LinkedOpportunitySummary | null;
  linkedOpportunityWarning: string | null;
  linkedQuoteDisplay: QuoteRequestQuoteDisplayState;
  linkedQuoteWarning: string | null;
  linkedAddress: { id: string; label: string | null; is_active: boolean } | null;
  linkedAddressWarning: string | null;
  suggestion: {
    contactName: string | null;
    contactEmail: string | null;
    companyName: string | null;
  } | null;
  confirmedContact: { id: string; fullName: string; email: string | null } | null;
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

function logAdminQuoteRequestQueryError(
  query:
    | "core request"
    | "address metadata"
    | "company"
    | "contact"
    | "requester"
    | "attachments"
    | "website artwork"
    | "linked quote"
    | "saved address",
  error: unknown,
  column?: string | null
) {
  const normalized = normalizeSupabaseQueryError(error);

  console.error("[admin quote request] query failed", {
    query,
    column: column ?? null,
    code: normalized.code ?? null,
    message: normalized.message ?? String(error),
    details: normalized.details ?? null,
    hint: normalized.hint ?? null,
  });
}

const QUOTE_REQUEST_WEBSITE_SELECT =
  "source, submitter_name, submitter_company_name, submitter_email, submitter_phone, project_location, existing_job_reference, artwork_pending, suggested_contact_id, suggested_company_id";

function emptyWebsiteFields(): Pick<
  AdminQuoteRequestDetail,
  | "source"
  | "submitter_name"
  | "submitter_company_name"
  | "submitter_email"
  | "submitter_phone"
  | "project_location"
  | "existing_job_reference"
  | "artwork_pending"
  | "suggested_contact_id"
  | "suggested_company_id"
> {
  return {
    source: "customer_portal",
    submitter_name: null,
    submitter_company_name: null,
    submitter_email: null,
    submitter_phone: null,
    project_location: null,
    existing_job_reference: null,
    artwork_pending: false,
    suggested_contact_id: null,
    suggested_company_id: null,
  };
}

function mapWebsiteFields(data: Record<string, unknown> | null | undefined) {
  const fields = emptyWebsiteFields();

  if (!data) {
    return fields;
  }

  fields.source = data.source === "website" ? "website" : "customer_portal";
  fields.submitter_name = typeof data.submitter_name === "string" ? data.submitter_name : null;
  fields.submitter_company_name =
    typeof data.submitter_company_name === "string" ? data.submitter_company_name : null;
  fields.submitter_email = typeof data.submitter_email === "string" ? data.submitter_email : null;
  fields.submitter_phone = typeof data.submitter_phone === "string" ? data.submitter_phone : null;
  fields.project_location = typeof data.project_location === "string" ? data.project_location : null;
  fields.existing_job_reference =
    typeof data.existing_job_reference === "string" ? data.existing_job_reference : null;
  fields.artwork_pending = data.artwork_pending === true;
  fields.suggested_contact_id =
    typeof data.suggested_contact_id === "string" ? data.suggested_contact_id : null;
  fields.suggested_company_id =
    typeof data.suggested_company_id === "string" ? data.suggested_company_id : null;

  return fields;
}

async function loadWebsiteFields(supabase: SupabaseClient, routeId: string) {
  const { data, error } = await supabase
    .from("quote_requests")
    .select(QUOTE_REQUEST_WEBSITE_SELECT)
    .eq("id", routeId)
    .maybeSingle();

  if (error) {
    logAdminQuoteRequestQueryError("core request", error);
    return { fields: emptyWebsiteFields(), warning: "Website enquiry details could not be loaded." };
  }

  return { fields: mapWebsiteFields(data as Record<string, unknown> | null), warning: null };
}

function emptyAddressMetadata(): Pick<
  AdminQuoteRequestDetail,
  | "delivery_country"
  | "delivery_instructions"
  | "delivery_address_label"
  | "selected_company_address_id"
  | "delivery_address_source"
> {
  return {
    delivery_country: null,
    delivery_instructions: null,
    delivery_address_label: null,
    selected_company_address_id: null,
    delivery_address_source: null,
  };
}

const QUOTE_REQUEST_OPTIONAL_METADATA_SELECT =
  QUOTE_REQUEST_OPTIONAL_METADATA_COLUMNS.join(", ");

function mapAddressMetadataRow(
  data: Record<string, unknown> | null | undefined
): ReturnType<typeof emptyAddressMetadata> {
  const metadata = emptyAddressMetadata();

  for (const column of QUOTE_REQUEST_OPTIONAL_METADATA_COLUMNS) {
    const rawValue = data?.[column];
    metadata[column] =
      typeof rawValue === "string"
        ? rawValue
        : rawValue == null
          ? null
          : String(rawValue);
  }

  return metadata;
}

async function loadAddressMetadata(
  supabase: SupabaseClient,
  routeId: string
): Promise<{
  metadata: ReturnType<typeof emptyAddressMetadata>;
  warning: string | null;
}> {
  try {
    const { data, error } = await supabase
      .from("quote_requests")
      .select(QUOTE_REQUEST_OPTIONAL_METADATA_SELECT)
      .eq("id", routeId)
      .maybeSingle();

    if (!error) {
      if (process.env.NODE_ENV === "development") {
        console.log("[admin quote request] address metadata loaded", {
          routeId,
          columnsAvailable: true,
          values: mapAddressMetadataRow(
            data as Record<string, unknown> | null | undefined
          ),
        });
      }

      return {
        metadata: mapAddressMetadataRow(
          data as Record<string, unknown> | null | undefined
        ),
        warning: null,
      };
    }

    const normalized = normalizeSupabaseQueryError(error);
    logAdminQuoteRequestQueryError("address metadata", error);

    if (isPostgrestSchemaCacheError(normalized)) {
      if (process.env.NODE_ENV === "development") {
        console.log("[admin quote request] metadata warning trigger", {
          routeId,
          condition: "isPostgrestSchemaCacheError(normalized) === true",
          code: normalized.code ?? null,
          message: normalized.message ?? null,
        });
      }

      return {
        metadata: emptyAddressMetadata(),
        warning:
          "PostgREST schema cache may be stale. Run: notify pgrst, 'reload schema';",
      };
    }

    if (isMissingColumnError(normalized)) {
      const missingColumns: string[] = [];

      for (const column of QUOTE_REQUEST_OPTIONAL_METADATA_COLUMNS) {
        const columnResult = await supabase
          .from("quote_requests")
          .select(column)
          .eq("id", routeId)
          .maybeSingle();

        if (
          columnResult.error &&
          isMissingColumnError(normalizeSupabaseQueryError(columnResult.error))
        ) {
          missingColumns.push(column);
        }
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[admin quote request] metadata warning trigger", {
          routeId,
          condition: "isMissingColumnError(normalized) === true",
          code: normalized.code ?? null,
          message: normalized.message ?? null,
          missingColumns,
        });
      }

      return {
        metadata: emptyAddressMetadata(),
        warning:
          missingColumns.length > 0
            ? `Extended delivery address metadata is unavailable. Missing quote_requests columns: ${missingColumns.join(", ")}. Apply docs/proposed-quote-request-address-migration.sql.`
            : "Extended delivery address metadata is unavailable. Apply docs/proposed-quote-request-address-migration.sql to enable saved-address traceability fields.",
      };
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[admin quote request] metadata warning trigger", {
        routeId,
        condition: "metadata query failed with non-schema error",
        code: normalized.code ?? null,
        message: normalized.message ?? null,
      });
    }

    return {
      metadata: emptyAddressMetadata(),
      warning: "Extended delivery details could not be loaded.",
    };
  } catch (error) {
    logAdminQuoteRequestQueryError("address metadata", error);

    return {
      metadata: emptyAddressMetadata(),
      warning: "Extended delivery details could not be loaded.",
    };
  }
}

function isMissingArtworkRpc(error: { code?: string; message?: string }) {
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    Boolean(error.message?.includes("Could not find the function")) ||
    Boolean(error.message?.includes("does not exist"))
  );
}

async function loadWebsiteArtwork(supabase: SupabaseClient, routeId: string) {
  const { error: expireError } = await supabase.rpc("quote_request_dropbox_expire_enquiry", {
    p_quote_request_id: routeId,
  });

  if (expireError && !isMissingArtworkRpc(normalizeSupabaseQueryError(expireError))) {
    logAdminQuoteRequestQueryError("website artwork", expireError);
  }

  const { data, error } = await supabase
    .from("quote_request_dropbox_files")
    .select("id, original_file_name, file_size_bytes, mime_type, upload_status, created_at")
    .eq("quote_request_id", routeId)
    .order("created_at", { ascending: false });

  if (error) {
    logAdminQuoteRequestQueryError("website artwork", error);

    if (isMissingRelationError(normalizeSupabaseQueryError(error))) {
      return {
        files: [],
        warning: "Website artwork could not be loaded because its table is unavailable.",
      };
    }

    return {
      files: [],
      warning: "Website artwork could not be loaded.",
    };
  }

  const files: WebsiteArtworkListItem[] = [];

  for (const row of data ?? []) {
    if (
      row.upload_status !== "pending" &&
      row.upload_status !== "uploaded" &&
      row.upload_status !== "failed"
    ) {
      continue;
    }

    files.push({
      id: row.id,
      originalFileName: row.original_file_name,
      fileSizeBytes: row.file_size_bytes,
      mimeType: row.mime_type,
      uploadStatus: row.upload_status,
      createdAt: row.created_at,
    });
  }

  return { files, warning: null };
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

    const normalized = normalizeSupabaseQueryError(coreError);

    return {
      kind: "core_error",
      message: "Quote request could not be loaded.",
      devMessage:
        process.env.NODE_ENV === "development"
          ? normalized.message ?? String(coreError)
          : null,
    };
  }

  if (!coreRequest) {
    return { kind: "not_found" };
  }

  const warnings: string[] = [];
  const [{ metadata, warning: metadataWarning }, websiteLoad] = await Promise.all([
    loadAddressMetadata(supabase, routeId),
    loadWebsiteFields(supabase, routeId),
  ]);

  if (metadataWarning) {
    warnings.push(metadataWarning);
  }

  if (websiteLoad.warning) {
    warnings.push(websiteLoad.warning);
  }

  const quoteRequest: AdminQuoteRequestDetail = {
    ...coreRequest,
    ...metadata,
    ...websiteLoad.fields,
  };

  const related: AdminQuoteRequestRelatedData = {
    company: null,
    companyWarning: null,
    requester: null,
    requesterWarning: null,
    attachments: [],
    attachmentsWarning: null,
    dropboxFiles: [],
    dropboxFilesWarning: null,
    linkedQuote: null,
    linkedOpportunity: null,
    linkedOpportunityWarning: null,
    linkedQuoteDisplay: buildQuoteRequestDisplayState({
      linkedQuote: null,
      linkedOpportunity: null,
    }),
    linkedQuoteWarning: null,
    linkedAddress: null,
    linkedAddressWarning: null,
    suggestion: null,
    confirmedContact: null,
  };

  if (quoteRequest.company_id) {
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
  }

  if (quoteRequest.requested_by) {
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
  }

  const { data: attachments, error: attachmentsError } = await supabase
    .from("quote_request_attachments")
    .select("id, file_name, file_size, file_type, storage_path, created_at")
    .eq("quote_request_id", routeId)
    .order("created_at", { ascending: false });

  if (attachmentsError) {
    logAdminQuoteRequestQueryError("attachments", attachmentsError);

    if (isMissingRelationError(normalizeSupabaseQueryError(attachmentsError))) {
      related.attachmentsWarning =
        "Attachments could not be loaded because quote_request_attachments is unavailable.";
    } else {
      related.attachmentsWarning = "Attachments could not be loaded.";
    }
  } else {
    related.attachments = attachments ?? [];
  }

  if (quoteRequest.source === "website") {
    const artwork = await loadWebsiteArtwork(supabase, routeId);
    related.dropboxFiles = artwork.files;
    related.dropboxFilesWarning = artwork.warning;
  }

  const linkedQuoteLoad = await loadLinkedQuoteForRequest(supabase, {
    id: routeId,
    opportunityId: quoteRequest.opportunity_id,
  });
  related.linkedQuote = linkedQuoteLoad.quote;
  related.linkedOpportunity = linkedQuoteLoad.opportunity;
  related.linkedQuoteDisplay = buildQuoteRequestDisplayState({
    linkedQuote: linkedQuoteLoad.quote,
    linkedOpportunity: linkedQuoteLoad.opportunity,
    loadError: linkedQuoteLoad.loadError,
  });

  if (linkedQuoteLoad.loadError) {
    logAdminQuoteRequestQueryError(
      "linked quote",
      new Error(linkedQuoteLoad.loadError)
    );
    related.linkedQuoteWarning = linkedQuoteLoad.loadError;
  }

  if (!related.linkedOpportunity && quoteRequest.opportunity_id) {
    const opportunityLoad = await loadLinkedOpportunity(
      supabase,
      quoteRequest.opportunity_id
    );
    related.linkedOpportunity = opportunityLoad.opportunity;
    related.linkedOpportunityWarning = opportunityLoad.loadError;
    related.linkedQuoteDisplay = buildQuoteRequestDisplayState({
      linkedQuote: related.linkedQuote,
      linkedOpportunity: related.linkedOpportunity,
      loadError: linkedQuoteLoad.loadError ?? opportunityLoad.loadError,
    });
  }

  if (quoteRequest.source === "website") {
    const [suggestedContact, suggestedCompany] = await Promise.all([
      quoteRequest.suggested_contact_id
        ? supabase
            .from("contacts")
            .select("full_name, email")
            .eq("id", quoteRequest.suggested_contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      quoteRequest.suggested_company_id
        ? supabase
            .from("companies")
            .select("company_name")
            .eq("id", quoteRequest.suggested_company_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (suggestedContact.data || suggestedCompany.data) {
      related.suggestion = {
        contactName: suggestedContact.data?.full_name ?? null,
        contactEmail: suggestedContact.data?.email ?? null,
        companyName: suggestedCompany.data?.company_name ?? null,
      };
    }

    let confirmedContactId: string | null = null;

    if (quoteRequest.opportunity_id) {
      const { data: opportunity } = await supabase
        .from("opportunities")
        .select("contact_id")
        .eq("id", quoteRequest.opportunity_id)
        .maybeSingle();
      confirmedContactId = opportunity?.contact_id ?? null;
    }

    if (!confirmedContactId && quoteRequest.company_id) {
      const { data: activity } = await supabase
        .from("crm_activity")
        .select("contact_id")
        .eq("activity_type", "quote_request_contact_confirmed")
        .eq("company_id", quoteRequest.company_id)
        .contains("metadata", { quote_request_id: routeId })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      confirmedContactId = activity?.contact_id ?? null;
    }

    if (confirmedContactId) {
      const { data: confirmed } = await supabase
        .from("contacts")
        .select("id, full_name, email")
        .eq("id", confirmedContactId)
        .maybeSingle();

      if (confirmed) {
        related.confirmedContact = {
          id: confirmed.id,
          fullName: confirmed.full_name,
          email: confirmed.email,
        };
      }
    }
  }

  if (quoteRequest.selected_company_address_id) {
    try {
      const { data: linkedAddress, error: linkedAddressError } = await supabase
        .from("company_addresses")
        .select("id, label, is_active")
        .eq("id", quoteRequest.selected_company_address_id)
        .maybeSingle();

      if (linkedAddressError) {
        logAdminQuoteRequestQueryError("saved address", linkedAddressError);

        if (
          isMissingRelationError(normalizeSupabaseQueryError(linkedAddressError))
        ) {
          related.linkedAddressWarning =
            "Saved address link is unavailable. Apply docs/proposed-customer-settings-migration.sql to enable company_addresses.";
        } else {
          related.linkedAddressWarning =
            "Saved address link could not be loaded. The submitted address snapshot below remains authoritative.";
        }
      } else if (linkedAddress) {
        related.linkedAddress = linkedAddress;
      }
    } catch (error) {
      logAdminQuoteRequestQueryError("saved address", error);
      related.linkedAddressWarning =
        "Saved address link could not be loaded. The submitted address snapshot below remains authoritative.";
    }
  }

  return {
    kind: "found",
    quoteRequest,
    related,
    warnings,
  };
}
