import type { SupabaseClient } from "@supabase/supabase-js";

import { createQuoteItemImageSignedUrl } from "@/lib/quote-item-images";
import { resolveCustomerQuoteStatus } from "@/lib/quote-customer-status";

export type { LinkedQuoteRequestDeadlineLoadResult } from "@/lib/customer-formal-quote-deadline";
export { formatApprovedQuoteDeadline, loadLinkedQuoteRequestDeadline } from "@/lib/customer-formal-quote-deadline";

export type CustomerFormalQuoteLineItemData = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  imageUrl: string | null;
  imageFileName: string | null;
};

export type CustomerFormalQuoteData = {
  quoteId: string;
  quoteNumber: number;
  projectName: string;
  quoteStatus: string;
  versionStatus: string;
  versionNumber: number;
  dateSent: string | null;
  expiryDate: string | null;
  paymentTermsDays: number | null;
  introduction: string | null;
  customerNotes: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  lineItems: CustomerFormalQuoteLineItemData[];
  linkedRequestId: string | null;
  customerCompanyName: string | null;
  customerContactName: string | null;
  customerEmail: string | null;
};

export type CustomerFormalQuotePdfInput = CustomerFormalQuoteData & {
  approvedDeadline: string | null;
};

export async function fetchCustomerFormalQuote(
  supabase: SupabaseClient,
  quoteId: string,
  {
    customerContactName,
    customerEmail,
    fallbackCompanyName,
  }: {
    customerContactName: string;
    customerEmail: string | null;
    fallbackCompanyName: string;
  }
): Promise<CustomerFormalQuoteData | null> {
  const { data: formalQuote } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, project_name, status, current_version, quote_request_id, company_id"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (!formalQuote) {
    return null;
  }

  const [{ data: quoteVersions }, { data: customerCompany }] = await Promise.all([
    supabase
      .from("quote_versions")
      .select(
        "id, version_number, version_status, created_at, expiry_date, payment_terms_days, introduction, customer_notes, subtotal, vat_amount, total"
      )
      .eq("quote_id", formalQuote.id)
      .order("version_number", { ascending: false }),
    formalQuote.company_id
      ? supabase
          .from("companies")
          .select("company_name")
          .eq("id", formalQuote.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const displayVersion =
    quoteVersions?.find(
      (version) =>
        version.version_number === formalQuote.current_version &&
        version.version_status !== "draft"
    ) ?? quoteVersions?.find((version) => version.version_status !== "draft");

  if (!displayVersion) {
    return null;
  }

  const { data: formalQuoteItems } = await supabase
    .from("quote_items")
    .select(
      "id, title, description, quantity, unit_price, is_optional, line_total, sort_order, image_storage_path, image_file_name"
    )
    .eq("quote_version_id", displayVersion.id)
    .order("sort_order", { ascending: true });

  const lineItems = await Promise.all(
    (formalQuoteItems ?? []).map(async (item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total),
      isOptional: Boolean(item.is_optional),
      imageUrl: item.image_storage_path
        ? await createQuoteItemImageSignedUrl(supabase, item.image_storage_path)
        : null,
      imageFileName: item.image_file_name,
    }))
  );

  const customerQuoteStatus = await resolveCustomerQuoteStatus(
    supabase,
    formalQuote
  );

  return {
    quoteId: formalQuote.id,
    quoteNumber: formalQuote.quote_number,
    projectName: formalQuote.project_name,
    quoteStatus: customerQuoteStatus,
    versionStatus: displayVersion.version_status,
    versionNumber: displayVersion.version_number,
    dateSent: displayVersion.created_at,
    expiryDate: displayVersion.expiry_date,
    paymentTermsDays: displayVersion.payment_terms_days,
    introduction: displayVersion.introduction,
    customerNotes: displayVersion.customer_notes,
    subtotal: Number(displayVersion.subtotal ?? 0),
    vatAmount: Number(displayVersion.vat_amount ?? 0),
    total: Number(displayVersion.total ?? 0),
    lineItems,
    linkedRequestId: formalQuote.quote_request_id,
    customerCompanyName:
      customerCompany?.company_name ?? fallbackCompanyName ?? null,
    customerContactName,
    customerEmail,
  };
}
