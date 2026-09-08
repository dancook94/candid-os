import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatCrmDate } from "@/lib/crm/format-datetime";
import { isLikelyNonPrintLine, MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";

export type SlackJobSummaryProductionItem = {
  headline: string;
  detail: string | null;
};

export type SlackJobSummaryContext = {
  jobId: string;
  jobReference: string;
  projectName: string;
  companyName: string;
  quoteReference: string | null;
  ownerName: string | null;
  requiredDateLabel: string | null;
  requiredTimeLabel: string | null;
  fulfilmentLabel: string | null;
  isDelivery: boolean;
  isCollection: boolean;
  deliveryAddressLines: string[];
  siteContactName: string | null;
  siteContactPhone: string | null;
  purchaseOrderNumber: string | null;
  productionItems: SlackJobSummaryProductionItem[];
  notes: string | null;
  jobUrl: string | null;
};

function formatRequiredTime(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim();

  if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const [hours, minutes] = trimmed.split(":");
    return `${hours}:${minutes}`;
  }

  return trimmed;
}

function buildDeliveryAddressLines(input: {
  line1: string | null;
  line2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
}) {
  return [
    input.line1?.trim(),
    input.line2?.trim(),
    [input.city?.trim(), input.county?.trim()].filter(Boolean).join(", ") || null,
    input.postcode?.trim(),
  ].filter(Boolean) as string[];
}

function formatProductionItem(item: {
  quantity: number | null;
  item_name: string;
  width_mm: number | null;
  height_mm: number | null;
  material: string | null;
  finishing_notes: string | null;
}): SlackJobSummaryProductionItem {
  const quantityPrefix =
    item.quantity != null && item.quantity > 0 ? `${item.quantity} × ` : "";

  const headline = `${quantityPrefix}${item.item_name}`.trim();
  const detailParts: string[] = [];

  if (item.width_mm && item.height_mm) {
    detailParts.push(`${Math.round(item.width_mm)} × ${Math.round(item.height_mm)}mm`);
  }

  if (item.material?.trim()) {
    detailParts.push(item.material.trim());
  }

  if (item.finishing_notes?.trim()) {
    detailParts.push(item.finishing_notes.trim());
  }

  return {
    headline,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
  };
}

export async function loadSlackJobSummaryContext(
  adminClient: SupabaseClient,
  jobId: string,
  appBaseUrl: string | null
): Promise<SlackJobSummaryContext | null> {
  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select(
      "id, job_reference, project_name, company_id, quote_id, quote_request_id, opportunity_id, fulfilment_method, required_date"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (jobError || !job) {
    return null;
  }

  const [{ data: company }, { data: quote }, { data: quoteRequest }, { data: opportunity }] =
    await Promise.all([
      adminClient
        .from("companies")
        .select("company_name")
        .eq("id", job.company_id as string)
        .maybeSingle(),
      job.quote_id
        ? adminClient
            .from("quotes")
            .select("quote_number")
            .eq("id", job.quote_id as string)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.quote_request_id
        ? adminClient
            .from("quote_requests")
            .select(
              "requested_time, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, delivery_contact_name, delivery_contact_phone, purchase_order_number, notes, fulfilment_method"
            )
            .eq("id", job.quote_request_id as string)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.opportunity_id
        ? adminClient
            .from("opportunities")
            .select("owner_profile_id")
            .eq("id", job.opportunity_id as string)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  let ownerName: string | null = null;

  if (opportunity?.owner_profile_id) {
    const { data: owner } = await adminClient
      .from("profiles")
      .select("full_name")
      .eq("id", opportunity.owner_profile_id as string)
      .maybeSingle();

    ownerName = owner?.full_name?.trim() || null;
  }

  const { data: productionItems } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const fulfilmentMethod = (
    job.fulfilment_method ??
    quoteRequest?.fulfilment_method ??
    ""
  )
    .toString()
    .trim()
    .toLowerCase();

  const isDelivery = fulfilmentMethod === "delivery";
  const isCollection = fulfilmentMethod === "collection";

  const filteredItems = (productionItems ?? []).filter(
    (item) => !isLikelyNonPrintLine((item.item_name as string) ?? "")
  );

  return {
    jobId: job.id as string,
    jobReference: job.job_reference as string,
    projectName: job.project_name as string,
    companyName: company?.company_name?.trim() || "Unknown company",
    quoteReference: quote?.quote_number ? `Q-${quote.quote_number}` : null,
    ownerName,
    requiredDateLabel: job.required_date
      ? formatCrmDate(job.required_date as string)
      : null,
    requiredTimeLabel: formatRequiredTime(quoteRequest?.requested_time as string | null),
    fulfilmentLabel: isDelivery ? "DELIVERY" : isCollection ? "COLLECTION" : null,
    isDelivery,
    isCollection,
    deliveryAddressLines: isDelivery
      ? buildDeliveryAddressLines({
          line1: quoteRequest?.delivery_address_line_1 as string | null,
          line2: quoteRequest?.delivery_address_line_2 as string | null,
          city: quoteRequest?.delivery_city as string | null,
          county: quoteRequest?.delivery_county as string | null,
          postcode: quoteRequest?.delivery_postcode as string | null,
        })
      : [],
    siteContactName: (quoteRequest?.delivery_contact_name as string | null)?.trim() || null,
    siteContactPhone: (quoteRequest?.delivery_contact_phone as string | null)?.trim() || null,
    purchaseOrderNumber:
      (quoteRequest?.purchase_order_number as string | null)?.trim() || null,
    productionItems: filteredItems.map((item) =>
      formatProductionItem({
        quantity: item.quantity as number | null,
        item_name: item.item_name as string,
        width_mm: item.width_mm as number | null,
        height_mm: item.height_mm as number | null,
        material: item.material as string | null,
        finishing_notes: item.finishing_notes as string | null,
      })
    ),
    notes: (quoteRequest?.notes as string | null)?.trim() || null,
    jobUrl: appBaseUrl ? `${appBaseUrl}/admin/jobs/${job.id}` : null,
  };
}
