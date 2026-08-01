import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CustomerFormalQuoteView } from "@/components/customer-formal-quote-view";
import { QuoteRequestAttachmentUpload } from "@/components/quote-request-attachment-upload";
import { QuoteRequestAttachmentsList } from "@/components/quote-request-attachments-list";
import {
  EditQuoteRequestForm,
  type QuoteRequestEditableValues,
} from "@/components/edit-quote-request-form";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  getCustomerQuoteActionLabel,
  isCustomerQuoteViewable,
  isQuoteRequestLockedByFormalQuote,
  mapCustomerQuoteStatusToBadge,
  QUOTE_REQUEST_LOCKED_NOTICE,
} from "@/lib/customer-quote-request";
import { resolveCustomerQuoteStatus } from "@/lib/quote-customer-status";
import { createQuoteItemImageSignedUrl } from "@/lib/quote-item-images";
import type { QuoteRequestAttachmentRecord } from "@/lib/quote-request-attachments";

type QuoteRequestDetail = {
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
  purchase_order_number: string | null;
  notes: string | null;
  deadline_status: string;
  request_status: string;
  created_at: string;
};

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const badgeStatuses: BadgeStatus[] = [
  "pending",
  "approved",
  "disabled",
  "draft",
  "sent",
  "accepted",
  "declined",
];

const statusVariantMap: Record<string, BadgeStatus> = {
  pending: "pending",
  approved: "approved",
  disabled: "disabled",
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  submitted: "sent",
  reviewing: "pending",
  overdue: "declined",
  upcoming: "approved",
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatFulfilmentMethod(fulfilmentMethod: string) {
  return fulfilmentMethod === "collection" ? "Collection" : "Delivery";
}

function formatStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapRequestStatusToBadge(value: string): BadgeStatus {
  const mapped = statusVariantMap[value.toLowerCase()];

  if (mapped) {
    return mapped;
  }

  if (badgeStatuses.includes(value as BadgeStatus)) {
    return value as BadgeStatus;
  }

  return "draft";
}

function formatDeliveryAddress(quoteRequest: QuoteRequestDetail) {
  return [
    quoteRequest.delivery_address_line_1,
    quoteRequest.delivery_address_line_2,
    quoteRequest.delivery_city,
    quoteRequest.delivery_county,
    quoteRequest.delivery_postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatDeliveryContact(quoteRequest: QuoteRequestDetail) {
  if (
    !quoteRequest.delivery_contact_name &&
    !quoteRequest.delivery_contact_phone
  ) {
    return "—";
  }

  return [quoteRequest.delivery_contact_name, quoteRequest.delivery_contact_phone]
    .filter(Boolean)
    .join(" · ");
}

function toEditableValues(
  quoteRequest: QuoteRequestDetail
): QuoteRequestEditableValues {
  return {
    project_name: quoteRequest.project_name,
    description: quoteRequest.description,
    fulfilment_method:
      quoteRequest.fulfilment_method === "collection"
        ? "collection"
        : "delivery",
    requested_date: quoteRequest.requested_date,
    requested_time: quoteRequest.requested_time,
    delivery_address_line_1: quoteRequest.delivery_address_line_1,
    delivery_address_line_2: quoteRequest.delivery_address_line_2,
    delivery_city: quoteRequest.delivery_city,
    delivery_county: quoteRequest.delivery_county,
    delivery_postcode: quoteRequest.delivery_postcode,
    delivery_contact_name: quoteRequest.delivery_contact_name,
    delivery_contact_phone: quoteRequest.delivery_contact_phone,
    purchase_order_number: quoteRequest.purchase_order_number,
    notes: quoteRequest.notes,
  };
}

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  const { data: formalQuote } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, project_name, status, current_version, quote_request_id, company_id"
    )
    .eq("id", id)
    .maybeSingle();

  if (formalQuote) {
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
      ) ??
      quoteVersions?.find((version) => version.version_status !== "draft");

    if (!displayVersion) {
      notFound();
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
          ? await createQuoteItemImageSignedUrl(
              supabase,
              item.image_storage_path
            )
          : null,
        imageFileName: item.image_file_name,
      }))
    );

    const customerQuoteStatus = await resolveCustomerQuoteStatus(
      supabase,
      formalQuote
    );

    return (
      <AppShell userRole="customer" userName={fullName} companyName={companyName}>
        <CustomerFormalQuoteView
          quoteNumber={formalQuote.quote_number}
          projectName={formalQuote.project_name}
          quoteStatus={customerQuoteStatus}
          versionNumber={displayVersion.version_number}
          dateSent={displayVersion.created_at}
          expiryDate={displayVersion.expiry_date}
          paymentTermsDays={displayVersion.payment_terms_days}
          introduction={displayVersion.introduction}
          customerNotes={displayVersion.customer_notes}
          subtotal={Number(displayVersion.subtotal ?? 0)}
          vatAmount={Number(displayVersion.vat_amount ?? 0)}
          total={Number(displayVersion.total ?? 0)}
          lineItems={lineItems}
          linkedRequestId={formalQuote.quote_request_id}
          customerCompanyName={
            customerCompany?.company_name ?? companyName ?? null
          }
          customerContactName={fullName}
          customerEmail={user.email ?? null}
        />
      </AppShell>
    );
  }

  const { data: quoteRequest, error } = await supabase
    .from("quote_requests")
    .select(
      "id, company_id, requested_by, project_name, description, fulfilment_method, requested_date, requested_time, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, delivery_contact_name, delivery_contact_phone, purchase_order_number, notes, deadline_status, request_status, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !quoteRequest) {
    notFound();
  }

  const { data: attachments } = await supabase
    .from("quote_request_attachments")
    .select("id, file_name, file_size, file_type, storage_path, created_at")
    .eq("quote_request_id", id)
    .order("created_at", { ascending: false });

  const { data: linkedQuote } = await supabase
    .from("quotes")
    .select("id, status")
    .eq("quote_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const quoteAttachments: QuoteRequestAttachmentRecord[] = attachments ?? [];
  const customerQuoteStatus = linkedQuote
    ? await resolveCustomerQuoteStatus(supabase, linkedQuote)
    : undefined;
  const quoteActionLabel = getCustomerQuoteActionLabel(customerQuoteStatus);
  const quoteStatusIsClickable = isCustomerQuoteViewable(customerQuoteStatus);
  const isLockedByFormalQuote = isQuoteRequestLockedByFormalQuote(
    customerQuoteStatus
  );

  const canEdit =
    !isLockedByFormalQuote &&
    (quoteRequest.request_status === "submitted" ||
      quoteRequest.request_status === "reviewing");

  const isDelivery = quoteRequest.fulfilment_method === "delivery";

  return (
    <AppShell userRole="customer" userName={fullName} companyName={companyName}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={quoteRequest.project_name}
          description="Quote request details"
          actions={
            <Link href="/quotes">
              <Button variant="outline">Back to quotes</Button>
            </Link>
          }
        />

        {isLockedByFormalQuote && (
          <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm text-neutral-700">{QUOTE_REQUEST_LOCKED_NOTICE}</p>
          </div>
        )}

        <EditQuoteRequestForm
          quoteRequestId={quoteRequest.id}
          canEdit={canEdit}
          initialValues={toEditableValues(quoteRequest)}
        >
          <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
            <CardHeader className="border-b border-neutral-200">
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="text-neutral-500">Deadline status</p>
                  <div className="mt-2">
                    <StatusBadge
                      status={mapRequestStatusToBadge(quoteRequest.deadline_status)}
                      label={formatStatusLabel(quoteRequest.deadline_status)}
                    />
                  </div>
                </div>

                <div>
                  <p className="text-neutral-500">Request status</p>
                  <div className="mt-2">
                    <StatusBadge
                      status={mapRequestStatusToBadge(quoteRequest.request_status)}
                      label={formatStatusLabel(quoteRequest.request_status)}
                    />
                  </div>
                </div>

                <div>
                  <p className="text-neutral-500">Quote status</p>
                  <div className="mt-2">
                    {quoteStatusIsClickable && linkedQuote ? (
                      <Link href={`/quotes/${linkedQuote.id}`} className="inline-flex">
                        <StatusBadge
                          status={mapCustomerQuoteStatusToBadge(customerQuoteStatus!)}
                          label={quoteActionLabel}
                        />
                      </Link>
                    ) : (
                      <span className="text-neutral-950">{quoteActionLabel}</span>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              <dl className="space-y-5 text-sm">
                <div>
                  <dt className="text-neutral-500">Project name</dt>
                  <dd className="mt-1 font-medium text-neutral-950">
                    {quoteRequest.project_name}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Description</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.description}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Fulfilment</dt>
                  <dd className="mt-1 font-medium text-neutral-950">
                    {formatFulfilmentMethod(quoteRequest.fulfilment_method)}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Requested date</dt>
                  <dd className="mt-1 text-neutral-950">
                    {formatDate(quoteRequest.requested_date)}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Requested time</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.requested_time || "—"}
                  </dd>
                </div>

                {isDelivery && (
                  <>
                    <div>
                      <dt className="text-neutral-500">Delivery address</dt>
                      <dd className="mt-1 text-neutral-950">
                        {formatDeliveryAddress(quoteRequest)}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-neutral-500">Delivery contact</dt>
                      <dd className="mt-1 text-neutral-950">
                        {formatDeliveryContact(quoteRequest)}
                      </dd>
                    </div>
                  </>
                )}

                <div>
                  <dt className="text-neutral-500">Purchase order number</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.purchase_order_number || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Notes</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.notes || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Submitted date</dt>
                  <dd className="mt-1 text-neutral-950">
                    {formatDate(quoteRequest.created_at)}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Request status</dt>
                  <dd className="mt-1">
                    <StatusBadge
                      status={mapRequestStatusToBadge(quoteRequest.request_status)}
                      label={formatStatusLabel(quoteRequest.request_status)}
                    />
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Quote status</dt>
                  <dd className="mt-1">
                    {quoteStatusIsClickable && linkedQuote ? (
                      <Link href={`/quotes/${linkedQuote.id}`} className="inline-flex">
                        <StatusBadge
                          status={mapCustomerQuoteStatusToBadge(customerQuoteStatus!)}
                          label={quoteActionLabel}
                        />
                      </Link>
                    ) : (
                      <span className="text-neutral-950">{quoteActionLabel}</span>
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </EditQuoteRequestForm>

        <QuoteRequestAttachmentsList attachments={quoteAttachments} />

        {canEdit && (
          <QuoteRequestAttachmentUpload
            quoteRequestId={quoteRequest.id}
            companyId={quoteRequest.company_id}
            uploadedBy={user.id}
          />
        )}
      </div>
    </AppShell>
  );
}
