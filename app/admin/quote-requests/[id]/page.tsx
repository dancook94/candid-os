import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import type { QuoteRequestAttachmentRecord } from "@/lib/quote-request-attachments";
import { formatAdminQuoteStatusLabel } from "@/lib/admin-quote-status";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

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
  quoted: "accepted",
  cancelled: "declined",
  alternative_proposed: "sent",
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

function formatDeliveryAddress(quoteRequest: QuoteRequestDetail) {
  const address = [
    quoteRequest.delivery_address_line_1,
    quoteRequest.delivery_address_line_2,
    quoteRequest.delivery_city,
    quoteRequest.delivery_county,
    quoteRequest.delivery_postcode,
  ]
    .filter(Boolean)
    .join(", ");

  return address || "—";
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

type AdminQuoteRequestDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminQuoteRequestDetailPage({
  params,
}: AdminQuoteRequestDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(`/admin/quote-requests/${id}`));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.user_role !== "admin" ||
    profile.account_status !== "approved"
  ) {
    redirect("/dashboard");
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

  const [{ data: company }, { data: requester }, { data: attachments }, { data: linkedQuote }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("company_name")
        .eq("id", quoteRequest.company_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", quoteRequest.requested_by)
        .maybeSingle(),
      supabase
        .from("quote_request_attachments")
        .select("id, file_name, file_size, file_type, storage_path, created_at")
        .eq("quote_request_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("quotes")
        .select("id, status, quote_number")
        .eq("quote_request_id", id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const quoteAttachments: QuoteRequestAttachmentRecord[] = attachments ?? [];
  const isDelivery = quoteRequest.fulfilment_method === "delivery";

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={quoteRequest.project_name}
          description="Admin quote request review"
          actions={
            <div className="flex flex-wrap gap-2">
              {linkedQuote ? (
                <Link href={`/admin/quotes/${linkedQuote.id}`}>
                  <Button>View quote Q-{linkedQuote.quote_number}</Button>
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
                        status={mapQuoteStatusToBadge(linkedQuote.status)}
                        label={formatAdminQuoteStatusLabel(linkedQuote.status)}
                      />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No quote yet</span>
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
                <dt className="text-neutral-500">Company</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {company?.company_name || "Unknown company"}
                </dd>
              </div>

              <div>
                <dt className="text-neutral-500">Requester</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {requester?.full_name || "Unknown requester"}
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
                        status={mapQuoteStatusToBadge(linkedQuote.status)}
                        label={formatAdminQuoteStatusLabel(linkedQuote.status)}
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

        <QuoteRequestAttachmentsList attachments={quoteAttachments} />

        <AdminQuoteRequestActions
          quoteRequestId={quoteRequest.id}
          initialRequestStatus={quoteRequest.request_status}
          initialDeadlineStatus={quoteRequest.deadline_status}
        />
      </div>
    </AppShell>
  );
}
