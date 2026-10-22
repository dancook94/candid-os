import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminQuoteRequestActions } from "@/components/admin-quote-request-actions";
import { AppShell } from "@/components/app-shell";
import { WebsiteEnquiryArtwork } from "@/components/website-enquiry-artwork";
import { WebsiteEnquiryManagement } from "@/components/website-enquiry-management";
import { PageHeader } from "@/components/page-header";
import { QuoteRequestAttachmentsList } from "@/components/quote-request-attachments-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AdminQuoteRequestDetail } from "@/lib/admin-quote-request-detail";
import { loadAdminQuoteRequestDetail } from "@/lib/admin-quote-request-detail";
import { formatAdminQuoteStatusLabel } from "@/lib/admin-quote-status";
import { loadAppSettings } from "@/lib/app-settings-server";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { formatCountryLabel } from "@/lib/quote-request/normalize-address";
import {
  quoteRequestSourceLabel,
  websiteEnquiryDetailItems,
  websiteSuggestionSummary,
} from "@/lib/quote-request/website-enquiry-display";
import type { QuoteRequestQuoteDisplayState } from "@/lib/quote-request-link";
import { createClient } from "@/lib/supabase/server";

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
  quoted: "accepted",
  cancelled: "declined",
  alternative_proposed: "sent",
};

function formatDeliveryAddressSource(source: string | null | undefined) {
  switch (source) {
    case "saved":
      return "Selected from saved addresses";
    case "new_saved":
      return "Newly entered and saved";
    case "new":
      return "Newly entered (one-off)";
    default:
      return "Submitted snapshot";
  }
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatFulfilmentMethod(fulfilmentMethod: string | null) {
  if (!fulfilmentMethod) {
    return "Not specified";
  }

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

const quoteStatusVariantMap: Record<string, BadgeStatus> = {
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  expired: "disabled",
  superseded: "disabled",
};

function mapQuoteStatusToBadge(value: string): BadgeStatus {
  const mapped = quoteStatusVariantMap[value.toLowerCase()];

  if (mapped) {
    return mapped;
  }

  if (badgeStatuses.includes(value as BadgeStatus)) {
    return value as BadgeStatus;
  }

  return "draft";
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

function formatSentDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  return formatDate(value);
}

function quoteDisplayLabel(display: QuoteRequestQuoteDisplayState) {
  return display.adminLabel;
}

function quoteDisplayBadgeStatus(display: QuoteRequestQuoteDisplayState): BadgeStatus {
  switch (display.kind) {
    case "awaiting":
      return "pending";
    case "opportunity_no_quote":
      return "pending";
    case "in_progress":
      return "draft";
    case "sent":
      return "sent";
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "load_error":
    case "integrity_error":
      return "disabled";
    default:
      return "draft";
  }
}
function formatDeliveryAddress(quoteRequest: AdminQuoteRequestDetail) {
  const address = [
    quoteRequest.delivery_address_line_1,
    quoteRequest.delivery_address_line_2,
    quoteRequest.delivery_city,
    quoteRequest.delivery_county,
    quoteRequest.delivery_postcode,
    quoteRequest.delivery_country
      ? formatCountryLabel(quoteRequest.delivery_country)
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  return address || "—";
}

function formatDeliveryContact(quoteRequest: AdminQuoteRequestDetail) {
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

function SectionWarning({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      {message}
    </div>
  );
}

type AdminQuoteRequestDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminQuoteRequestDetailPage({
  params,
}: AdminQuoteRequestDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    `/admin/quote-requests/${id}`
  );

  const loadResult = await loadAdminQuoteRequestDetail(supabase, id);

  if (loadResult.kind === "not_found") {
    notFound();
  }

  const shellProps = await buildAdminAppShellProps(supabase, profile);

  if (loadResult.kind === "core_error") {
    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-4xl">
          <PageHeader
            title="Quote request"
            description="Admin quote request review"
            actions={
              <Link href="/admin/quote-requests">
                <Button variant="outline">Back to inbox</Button>
              </Link>
            }
          />

          <Card className="portal-surface overflow-hidden">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">
                {loadResult.message}
              </CardTitle>
            </CardHeader>
            {loadResult.devMessage ? (
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {loadResult.devMessage}
                </p>
              </CardContent>
            ) : null}
          </Card>
        </div>
      </AppShell>
    );
  }

  const { quoteRequest, related, warnings } = loadResult;
  const isWebsite = quoteRequest.source === "website";
  const isDelivery = quoteRequest.fulfilment_method === "delivery";
  const [{ data: websiteCompanies }, appSettingsResult] = isWebsite
    ? await Promise.all([
        supabase
          .from("companies")
          .select("id, company_name")
          .eq("is_active", true)
          .order("company_name"),
        loadAppSettings(supabase),
      ])
    : [{ data: [] }, null];
  const websiteDetails = isWebsite
    ? websiteEnquiryDetailItems({
        submitterName: quoteRequest.submitter_name,
        submitterCompanyName: quoteRequest.submitter_company_name,
        submitterEmail: quoteRequest.submitter_email,
        submitterPhone: quoteRequest.submitter_phone,
        projectName: quoteRequest.project_name,
        description: quoteRequest.description,
        requestedDateLabel: quoteRequest.requested_date
          ? formatDate(quoteRequest.requested_date)
          : null,
        requestedTime: quoteRequest.requested_time,
        projectLocation: quoteRequest.project_location,
        existingJobReference: quoteRequest.existing_job_reference,
        artworkPending: quoteRequest.artwork_pending,
        submittedAtLabel: formatDate(quoteRequest.created_at),
        requestStatusLabel: formatStatusLabel(quoteRequest.request_status),
        linkedCompanyName: related.company?.company_name ?? null,
        companyId: quoteRequest.company_id,
      })
    : [];
  const suggestion = websiteSuggestionSummary(related.suggestion);
  const quoteDisplay = related.linkedQuoteDisplay;
  const linkedQuote = related.linkedQuote;
  const linkedOpportunity = related.linkedOpportunity;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={quoteRequest.project_name}
          description="Admin quote request review"
          actions={
            <div className="flex flex-wrap gap-2">
              {linkedOpportunity ? (
                <Link href={`/admin/opportunities/${linkedOpportunity.id}`}>
                  <Button variant="outline">View opportunity</Button>
                </Link>
              ) : null}
              {linkedQuote ? (
                <Link href={`/admin/quotes/${linkedQuote.id}`}>
                  <Button>
                    View quote Q-{linkedQuote.quoteNumber}
                  </Button>
                </Link>
              ) : linkedOpportunity ? (
                <Link
                  href={`/admin/quotes/new?opportunityId=${encodeURIComponent(linkedOpportunity.id)}`}
                >
                  <Button>Create quote</Button>
                </Link>
              ) : quoteDisplay.kind === "awaiting" && quoteRequest.source !== "website" ? (
                <Link href={`/admin/quotes/new?quoteRequestId=${quoteRequest.id}`}>
                  <Button>Create quote</Button>
                </Link>
              ) : null}
              <Link href="/admin/quote-requests">
                <Button variant="outline">Back to inbox</Button>
              </Link>
            </div>
          }
        />

        {warnings.length > 0 ? (
          <div className="mb-4 space-y-2">
            {warnings.map((warning) => (
              <SectionWarning key={warning} message={warning} />
            ))}
          </div>
        ) : null}

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
                  {linkedQuote ? (
                    <Link href={`/admin/quotes/${linkedQuote.id}`}>
                      <StatusBadge
                        status={quoteDisplayBadgeStatus(quoteDisplay)}
                        label={quoteDisplayLabel(quoteDisplay)}
                      />
                    </Link>
                  ) : quoteDisplay.kind === "load_error" ||
                    quoteDisplay.kind === "integrity_error" ? (
                    <span className="text-muted-foreground">
                      {quoteDisplayLabel(quoteDisplay)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {quoteDisplayLabel(quoteDisplay)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-6">
            {related.linkedQuoteWarning ? (
              <SectionWarning message={related.linkedQuoteWarning} />
            ) : null}

            {related.linkedOpportunityWarning ? (
              <SectionWarning message={related.linkedOpportunityWarning} />
            ) : null}

            {linkedOpportunity ? (
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 text-sm">
                <p className="font-medium text-neutral-950">Linked opportunity</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-neutral-500">Title</dt>
                    <dd className="mt-1 font-medium text-neutral-950">
                      {linkedOpportunity.title}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Stage</dt>
                    <dd className="mt-1 font-medium text-neutral-950">
                      {linkedOpportunity.stageLabel}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {linkedQuote ? (
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 text-sm">
                <p className="font-medium text-neutral-950">Linked quote</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-neutral-500">Quote number</dt>
                    <dd className="mt-1 font-medium text-neutral-950">
                      Q-{linkedQuote.quoteNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Quote status</dt>
                    <dd className="mt-1 font-medium text-neutral-950">
                      {formatAdminQuoteStatusLabel(linkedQuote.status)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Current total</dt>
                    <dd className="mt-1 font-medium text-neutral-950">
                      {formatCurrency(linkedQuote.total)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Sent date</dt>
                    <dd className="mt-1 font-medium text-neutral-950">
                      {formatSentDate(linkedQuote.sentAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : quoteDisplay.kind === "integrity_error" ? (
              <SectionWarning message={quoteDisplay.message} />
            ) : null}

            {isWebsite ? (
              <dl className="space-y-5 text-sm">
                {websiteDetails.map((item) => (
                  <div key={item.label}>
                    <dt className="text-neutral-500">{item.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap font-medium text-neutral-950">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
            <dl className="space-y-5 text-sm">
              <div>
                <dt className="text-neutral-500">Source</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {quoteRequestSourceLabel(quoteRequest.source)}
                </dd>
              </div>

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
                <dt className="text-neutral-500">Company</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {quoteRequest.company_id
                    ? related.company?.company_name || "Unknown company"
                    : "Unlinked"}
                </dd>
                {related.companyWarning ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {related.companyWarning}
                  </p>
                ) : null}
              </div>

              <div>
                <dt className="text-neutral-500">Requester</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {quoteRequest.requested_by
                    ? related.requester?.full_name || "Unknown requester"
                    : "No portal account"}
                </dd>
                {related.requesterWarning ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {related.requesterWarning}
                  </p>
                ) : null}
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
                  {quoteRequest.requested_date
                    ? formatDate(quoteRequest.requested_date)
                    : "Not specified"}
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
                    <dt className="text-neutral-500">Delivery details</dt>
                    <dd className="mt-1 text-neutral-950">
                      {formatDeliveryAddressSource(
                        quoteRequest.delivery_address_source
                      )}
                    </dd>
                  </div>

                  {quoteRequest.delivery_address_label ? (
                    <div>
                      <dt className="text-neutral-500">Address label</dt>
                      <dd className="mt-1 text-neutral-950">
                        {quoteRequest.delivery_address_label}
                      </dd>
                    </div>
                  ) : null}

                  <div>
                    <dt className="text-neutral-500">Recipient</dt>
                    <dd className="mt-1 text-neutral-950">
                      {quoteRequest.delivery_contact_name || "—"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Submitted address</dt>
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

                  {quoteRequest.delivery_instructions ? (
                    <div>
                      <dt className="text-neutral-500">Delivery instructions</dt>
                      <dd className="mt-1 text-neutral-950">
                        {quoteRequest.delivery_instructions}
                      </dd>
                    </div>
                  ) : null}

                  {related.linkedAddress ? (
                    <div>
                      <dt className="text-neutral-500">Saved address link</dt>
                      <dd className="mt-1 text-neutral-950">
                        {quoteRequest.company_id ? (
                          <Link
                            href={`/admin/companies/${quoteRequest.company_id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {related.linkedAddress.label || "Saved address"}
                            {!related.linkedAddress.is_active ? " (inactive)" : ""}
                          </Link>
                        ) : (
                          related.linkedAddress.label || "Saved address"
                        )}
                      </dd>
                    </div>
                  ) : related.linkedAddressWarning ? (
                    <div>
                      <dt className="text-neutral-500">Saved address link</dt>
                      <dd className="mt-1 text-xs text-amber-800">
                        {related.linkedAddressWarning}
                      </dd>
                    </div>
                  ) : null}
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
                <dt className="text-neutral-500">Created date</dt>
                <dd className="mt-1 text-neutral-950">
                  {formatDate(quoteRequest.created_at)}
                </dd>
              </div>

              <div>
                <dt className="text-neutral-500">Deadline status</dt>
                <dd className="mt-1">
                  <StatusBadge
                    status={mapRequestStatusToBadge(quoteRequest.deadline_status)}
                    label={formatStatusLabel(quoteRequest.deadline_status)}
                  />
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
                  {linkedQuote ? (
                    <Link
                      href={`/admin/quotes/${linkedQuote.id}`}
                      className="inline-flex"
                    >
                      <StatusBadge
                        status={quoteDisplayBadgeStatus(quoteDisplay)}
                        label={quoteDisplayLabel(quoteDisplay)}
                      />
                    </Link>
                  ) : (
                    <span className="text-neutral-950">
                      {quoteDisplayLabel(quoteDisplay)}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            )}

            {suggestion ? (
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 text-sm">
                <p className="font-medium text-neutral-950">Suggested existing record</p>
                <p className="mt-2 text-neutral-600">{suggestion.note}</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {suggestion.contactName ? (
                    <div>
                      <dt className="text-neutral-500">Suggested contact</dt>
                      <dd className="mt-1 font-medium text-neutral-950">
                        {suggestion.contactName}
                        {suggestion.contactEmail ? ` · ${suggestion.contactEmail}` : ""}
                      </dd>
                    </div>
                  ) : null}
                  {suggestion.companyName ? (
                    <div>
                      <dt className="text-neutral-500">Suggested company</dt>
                      <dd className="mt-1 font-medium text-neutral-950">{suggestion.companyName}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isWebsite ? (
          <WebsiteEnquiryManagement
            quoteRequestId={quoteRequest.id}
            companyId={quoteRequest.company_id}
            linkedCompanyName={related.company?.company_name ?? null}
            canChangeCompany={!quoteRequest.opportunity_id && !linkedQuote}
            companies={websiteCompanies ?? []}
            prefilledCompanyName={quoteRequest.submitter_company_name ?? ""}
            prefilledEmail={quoteRequest.submitter_email ?? ""}
            prefilledPhone={quoteRequest.submitter_phone ?? ""}
            prefilledContactName={quoteRequest.submitter_name ?? ""}
            defaultPaymentTermsDays={
              appSettingsResult?.settings.default_payment_terms_days ?? 14
            }
            confirmedContact={related.confirmedContact}
            hasOpportunity={Boolean(quoteRequest.opportunity_id)}
            hasQuote={Boolean(linkedQuote)}
          />
        ) : null}

        {related.attachmentsWarning ? (
          <div className="mt-4">
            <SectionWarning message={related.attachmentsWarning} />
          </div>
        ) : null}

        {isWebsite ? (
          <WebsiteEnquiryArtwork
            quoteRequestId={quoteRequest.id}
            artworkPending={quoteRequest.artwork_pending}
            files={related.dropboxFiles}
            warning={related.dropboxFilesWarning}
          />
        ) : null}

        {!isWebsite || related.attachments.length > 0 ? (
          <QuoteRequestAttachmentsList attachments={related.attachments} />
        ) : null}

        <AdminQuoteRequestActions
          quoteRequestId={quoteRequest.id}
          initialRequestStatus={quoteRequest.request_status}
          initialDeadlineStatus={quoteRequest.deadline_status}
        />
      </div>
    </AppShell>
  );
}
