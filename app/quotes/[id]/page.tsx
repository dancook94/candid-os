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
import {
  fetchCustomerFormalQuote,
  loadLinkedQuoteRequestDeadline,
} from "@/lib/customer-formal-quote-data";
import { createClient } from "@/lib/supabase/server";
import {
  buildCustomerAppShellProps,
  loadCustomerPortalProfile,
} from "@/lib/customer-shell-props";
import {
  getCustomerQuoteActionLabel,
  getFormalQuoteStatusLabel,
  isCustomerQuotePdfDownloadable,
  isCustomerQuoteViewable,
  isQuoteRequestLockedByFormalQuote,
  mapCustomerQuoteStatusToBadge,
  QUOTE_REQUEST_LOCKED_NOTICE,
} from "@/lib/customer-quote-request";
import {
  buildQuoteRequestDisplayState,
  loadLinkedQuoteForRequest,
} from "@/lib/quote-request-link";
import { resolveCustomerQuoteStatus } from "@/lib/quote-customer-status";
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
  opportunity_id: string | null;
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

  const profile = await loadCustomerPortalProfile(supabase, user.id);
  const shellProps = await buildCustomerAppShellProps(supabase, user, profile);
  const fullName = shellProps.userName;

  const { data: formalQuoteExists } = await supabase
    .from("quotes")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (formalQuoteExists) {
    const { data: quoteLinkRow } = await supabase
      .from("quotes")
      .select("id, quote_request_id")
      .eq("id", id)
      .maybeSingle();

    if (process.env.NODE_ENV === "development") {
      console.log("[approved-deadline] quote link", {
        quoteId: quoteLinkRow?.id ?? id,
        quoteRequestId: quoteLinkRow?.quote_request_id ?? null,
      });
    }

    const formalQuote = await fetchCustomerFormalQuote(supabase, id, {
      customerContactName: fullName,
      customerEmail: user.email ?? null,
      fallbackCompanyName: shellProps.companyName,
    });

    if (!formalQuote) {
      notFound();
    }

    const deadlineLoad = await loadLinkedQuoteRequestDeadline(supabase, {
      quoteId: id,
      quoteRequestId: quoteLinkRow?.quote_request_id ?? null,
    });

    if (deadlineLoad.loadError && process.env.NODE_ENV === "development") {
      console.error(
        "[approved-deadline] quote request query error:",
        deadlineLoad.loadError
      );
    }

    return (
      <AppShell {...shellProps}>
        <CustomerFormalQuoteView
          quoteId={formalQuote.quoteId}
          showPdfDownload={isCustomerQuotePdfDownloadable(
            formalQuote.versionStatus
          )}
          quoteNumber={formalQuote.quoteNumber}
          projectName={formalQuote.projectName}
          quoteStatus={formalQuote.quoteStatus}
          versionNumber={formalQuote.versionNumber}
          canRespondToQuote={formalQuote.canRespondToQuote}
          dateSent={formalQuote.dateSent}
          expiryDate={formalQuote.expiryDate}
          paymentTermsDays={formalQuote.paymentTermsDays}
          approvedDeadline={deadlineLoad.approvedDeadline}
          deadlineDiagnostic={
            process.env.NODE_ENV === "development"
              ? deadlineLoad.diagnostic ?? deadlineLoad.loadError
              : null
          }
          introduction={formalQuote.introduction}
          customerNotes={formalQuote.customerNotes}
          subtotal={formalQuote.subtotal}
          vatAmount={formalQuote.vatAmount}
          total={formalQuote.total}
          lineItems={formalQuote.lineItems}
          linkedRequestId={formalQuote.linkedRequestId}
          customerCompanyName={formalQuote.customerCompanyName}
          customerContactName={formalQuote.customerContactName}
          customerEmail={formalQuote.customerEmail}
        />
      </AppShell>
    );
  }

  const { data: quoteRequest, error } = await supabase
    .from("quote_requests")
    .select(
      "id, company_id, requested_by, project_name, description, fulfilment_method, requested_date, requested_time, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, delivery_contact_name, delivery_contact_phone, purchase_order_number, notes, deadline_status, request_status, opportunity_id, created_at"
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

  const linkedQuoteLoad = await loadLinkedQuoteForRequest(supabase, {
    id,
    opportunityId: quoteRequest.opportunity_id,
  });
  const linkedQuote = linkedQuoteLoad.quote
    ? { id: linkedQuoteLoad.quote.id, status: linkedQuoteLoad.quote.status }
    : null;
  const quoteDisplay = buildQuoteRequestDisplayState({
    linkedQuote: linkedQuoteLoad.quote,
    linkedOpportunity: linkedQuoteLoad.opportunity,
    loadError: linkedQuoteLoad.loadError,
  });

  const quoteAttachments: QuoteRequestAttachmentRecord[] = attachments ?? [];
  const customerQuoteStatus = linkedQuote
    ? await resolveCustomerQuoteStatus(supabase, linkedQuote)
    : undefined;
  const quoteActionLabel =
    quoteDisplay.kind === "load_error" || quoteDisplay.kind === "integrity_error"
      ? quoteDisplay.customerLabel
      : getCustomerQuoteActionLabel(customerQuoteStatus);
  const quoteStatusLabel = customerQuoteStatus
    ? getFormalQuoteStatusLabel(customerQuoteStatus)
    : quoteDisplay.customerLabel;
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
    <AppShell {...shellProps}>
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
          <div className="mb-4 rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">{QUOTE_REQUEST_LOCKED_NOTICE}</p>
          </div>
        )}

        <EditQuoteRequestForm
          quoteRequestId={quoteRequest.id}
          canEdit={canEdit}
          initialValues={toEditableValues(quoteRequest)}
        >
          <Card className="portal-surface overflow-hidden">
            <CardHeader className="border-b border-border">
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="portal-field-label">Deadline status</p>
                  <div className="mt-2">
                    <StatusBadge
                      status={mapRequestStatusToBadge(quoteRequest.deadline_status)}
                      label={formatStatusLabel(quoteRequest.deadline_status)}
                    />
                  </div>
                </div>

                <div>
                  <p className="portal-field-label">Request status</p>
                  <div className="mt-2">
                    <StatusBadge
                      status={mapRequestStatusToBadge(quoteRequest.request_status)}
                      label={formatStatusLabel(quoteRequest.request_status)}
                    />
                  </div>
                </div>

                <div>
                  <p className="portal-field-label">Quote status</p>
                  <div className="mt-2">
                    {quoteStatusIsClickable && linkedQuote ? (
                      <Link href={`/quotes/${linkedQuote.id}`} className="inline-flex">
                        <StatusBadge
                          status={mapCustomerQuoteStatusToBadge(customerQuoteStatus!)}
                          label={quoteStatusLabel}
                        />
                      </Link>
                    ) : (
                      <span className="text-foreground">{quoteActionLabel}</span>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              <dl className="space-y-5 text-sm">
                <div>
                  <dt className="portal-field-label">Project name</dt>
                  <dd className="portal-detail-value">
                    {quoteRequest.project_name}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Description</dt>
                  <dd className="portal-detail-value">
                    {quoteRequest.description}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Fulfilment</dt>
                  <dd className="portal-detail-value">
                    {formatFulfilmentMethod(quoteRequest.fulfilment_method)}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Requested date</dt>
                  <dd className="portal-detail-value">
                    {formatDate(quoteRequest.requested_date)}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Requested time</dt>
                  <dd className="portal-detail-value">
                    {quoteRequest.requested_time || "—"}
                  </dd>
                </div>

                {isDelivery && (
                  <>
                    <div>
                      <dt className="portal-field-label">Delivery address</dt>
                      <dd className="portal-detail-value">
                        {formatDeliveryAddress(quoteRequest)}
                      </dd>
                    </div>

                    <div>
                      <dt className="portal-field-label">Delivery contact</dt>
                      <dd className="portal-detail-value">
                        {formatDeliveryContact(quoteRequest)}
                      </dd>
                    </div>
                  </>
                )}

                <div>
                  <dt className="portal-field-label">Purchase order number</dt>
                  <dd className="portal-detail-value">
                    {quoteRequest.purchase_order_number || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Notes</dt>
                  <dd className="portal-detail-value">
                    {quoteRequest.notes || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Submitted date</dt>
                  <dd className="portal-detail-value">
                    {formatDate(quoteRequest.created_at)}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Request status</dt>
                  <dd className="mt-1">
                    <StatusBadge
                      status={mapRequestStatusToBadge(quoteRequest.request_status)}
                      label={formatStatusLabel(quoteRequest.request_status)}
                    />
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Quote status</dt>
                  <dd className="mt-1">
                    {quoteStatusIsClickable && linkedQuote ? (
                      <Link href={`/quotes/${linkedQuote.id}`} className="inline-flex">
                        <StatusBadge
                          status={mapCustomerQuoteStatusToBadge(customerQuoteStatus!)}
                          label={quoteStatusLabel}
                        />
                      </Link>
                    ) : (
                      <span className="text-foreground">{quoteActionLabel}</span>
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
