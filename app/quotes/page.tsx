import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerCompanyBranding } from "@/lib/customer-company-branding";
import {
  getCustomerQuoteActionLabel,
  getFormalQuoteStatusLabel,
  isCustomerQuoteViewable,
  mapCustomerQuoteStatusToBadge,
} from "@/lib/customer-quote-request";
import { resolveCustomerQuoteStatuses } from "@/lib/quote-customer-status";

type QuoteRequest = {
  id: string;
  company_id: string;
  requested_by: string;
  project_name: string;
  description: string;
  fulfilment_method: string;
  requested_date: string;
  requested_time: string | null;
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

function formatRequestedDeadline(
  requestedDate: string,
  requestedTime: string | null
) {
  const formattedDate = formatDate(requestedDate);

  if (!requestedTime) {
    return formattedDate;
  }

  return `${formattedDate}, ${requestedTime}`;
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

export default async function QuotesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, company_id")
    .eq("id", user.id)
    .single();

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const fallbackCompanyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  const companyBranding = await loadCustomerCompanyBranding(
    supabase,
    profile?.company_id,
    fallbackCompanyName
  );

  const companyName = companyBranding.companyName;
  const companyLogoUrl = companyBranding.companyLogoUrl;

  const { data, error } = await supabase
    .from("quote_requests")
    .select(
      "id, company_id, requested_by, project_name, description, fulfilment_method, requested_date, requested_time, deadline_status, request_status, created_at"
    )
    .order("created_at", { ascending: false });

  const quoteRequests: QuoteRequest[] = data ?? [];
  const queryError = error?.message ?? null;
  const isDevelopment = process.env.NODE_ENV === "development";

  const requestIds = quoteRequests.map((request) => request.id);

  const { data: linkedQuotes } =
    requestIds.length > 0
      ? await supabase
          .from("quotes")
          .select("id, quote_request_id, status")
          .in("quote_request_id", requestIds)
          .order("updated_at", { ascending: false })
      : { data: [] as { id: string; quote_request_id: string | null; status: string }[] };

  const quoteByRequestId = new Map<string, { id: string; status: string }>();

  for (const quote of linkedQuotes ?? []) {
    if (quote.quote_request_id && !quoteByRequestId.has(quote.quote_request_id)) {
      quoteByRequestId.set(quote.quote_request_id, {
        id: quote.id,
        status: quote.status,
      });
    }
  }

  const customerQuoteStatuses = await resolveCustomerQuoteStatuses(
    supabase,
    (linkedQuotes ?? []).map((quote) => ({ id: quote.id, status: quote.status }))
  );

  const requestQuoteButton = (
    <Link href="/quotes/request">
      <Button>Request a quote</Button>
    </Link>
  );

  return (
    <AppShell
      userRole="customer"
      userName={fullName}
      companyName={companyName}
      companyLogoUrl={companyLogoUrl}
    >
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Quotes"
          description="View and track your quote requests."
          actions={requestQuoteButton}
        />

        {isDevelopment && queryError ? (
          <Card className="rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-red-800">
                Supabase query error
              </p>
              <p className="mt-2 text-sm text-red-700">{queryError}</p>
            </CardContent>
          </Card>
        ) : quoteRequests.length === 0 ? (
          <EmptyState
            title="No quote requests yet"
            description="Submit your first quote request to get started."
            action={requestQuoteButton}
          />
        ) : (
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Submitted</th>
                      <th>Requested deadline</th>
                      <th>Fulfilment</th>
                      <th>Deadline status</th>
                      <th>Request status</th>
                      <th>Quote status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {quoteRequests.map((request) => {
                      const linkedQuote = quoteByRequestId.get(request.id);
                      const customerQuoteStatus = linkedQuote
                        ? (customerQuoteStatuses.get(linkedQuote.id) ??
                          linkedQuote.status)
                        : undefined;
                      const quoteActionLabel =
                        getCustomerQuoteActionLabel(customerQuoteStatus);
                      const quoteStatusLabel = customerQuoteStatus
                        ? getFormalQuoteStatusLabel(customerQuoteStatus)
                        : quoteActionLabel;
                      const quoteStatusIsClickable =
                        isCustomerQuoteViewable(customerQuoteStatus);

                      return (
                      <tr
                        key={request.id}
                        className="cursor-pointer hover:bg-muted/35"
                      >
                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 font-medium text-foreground"
                          >
                            {request.project_name}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 text-muted-foreground"
                          >
                            {formatDate(request.created_at)}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 text-muted-foreground"
                          >
                            {formatRequestedDeadline(
                              request.requested_date,
                              request.requested_time
                            )}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 text-muted-foreground"
                          >
                            {formatFulfilmentMethod(request.fulfilment_method)}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4"
                          >
                            <StatusBadge
                              status={mapRequestStatusToBadge(request.deadline_status)}
                              label={formatStatusLabel(request.deadline_status)}
                            />
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4"
                          >
                            <StatusBadge
                              status={mapRequestStatusToBadge(request.request_status)}
                              label={formatStatusLabel(request.request_status)}
                            />
                          </Link>
                        </td>

                        <td className="p-4">
                          {quoteStatusIsClickable && linkedQuote ? (
                            <Link
                              href={`/quotes/${linkedQuote.id}`}
                              className="inline-flex"
                            >
                              <StatusBadge
                                status={mapCustomerQuoteStatusToBadge(
                                  customerQuoteStatus!
                                )}
                                label={quoteStatusLabel}
                              />
                            </Link>
                          ) : (
                            <span className="text-neutral-600">
                              {quoteActionLabel}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
