import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminQuoteRequestActions } from "@/components/admin-quote-request-actions";
import { AppShell } from "@/components/app-shell";
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
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { formatCountryLabel } from "@/lib/quote-request/normalize-address";
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
  const isDelivery = quoteRequest.fulfilment_method === "delivery";

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={quoteRequest.project_name}
          description="Admin quote request review"
          actions={
            <div className="flex flex-wrap gap-2">
              {related.linkedQuote ? (
                <Link href={`/admin/quotes/${related.linkedQuote.id}`}>
                  <Button>
                    View quote Q-{related.linkedQuote.quote_number}
                  </Button>
                </Link>
              ) : (
                <Link href={`/admin/quotes/new?quoteRequestId=${quoteRequest.id}`}>
                  <Button>Create quote</Button>
                </Link>
              )}
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
                  {related.linkedQuote ? (
                    <Link href={`/admin/quotes/${related.linkedQuote.id}`}>
                      <StatusBadge
                        status={mapQuoteStatusToBadge(related.linkedQuote.status)}
                        label={formatAdminQuoteStatusLabel(related.linkedQuote.status)}
                      />
                    </Link>
                  ) : related.linkedQuoteWarning ? (
                    <span className="text-muted-foreground">Unavailable</span>
                  ) : (
                    <span className="text-muted-foreground">No quote yet</span>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-6">
            {related.linkedQuoteWarning ? (
              <SectionWarning message={related.linkedQuoteWarning} />
            ) : null}

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
                <dt className="text-neutral-500">Company</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {related.company?.company_name || "Unknown company"}
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
                  {related.requester?.full_name || "Unknown requester"}
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
                        <Link
                          href={`/admin/companies/${quoteRequest.company_id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {related.linkedAddress.label || "Saved address"}
                          {!related.linkedAddress.is_active ? " (inactive)" : ""}
                        </Link>
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
                  {related.linkedQuote ? (
                    <Link
                      href={`/admin/quotes/${related.linkedQuote.id}`}
                      className="inline-flex"
                    >
                      <StatusBadge
                        status={mapQuoteStatusToBadge(related.linkedQuote.status)}
                        label={formatAdminQuoteStatusLabel(related.linkedQuote.status)}
                      />
                    </Link>
                  ) : (
                    <span className="text-neutral-950">No quote yet</span>
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {related.attachmentsWarning ? (
          <div className="mt-4">
            <SectionWarning message={related.attachmentsWarning} />
          </div>
        ) : null}

        <QuoteRequestAttachmentsList attachments={related.attachments} />

        <AdminQuoteRequestActions
          quoteRequestId={quoteRequest.id}
          initialRequestStatus={quoteRequest.request_status}
          initialDeadlineStatus={quoteRequest.deadline_status}
        />
      </div>
    </AppShell>
  );
}
