import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

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

const customerQuoteStatusLabels: Record<string, string> = {
  draft: "In progress",
  sent: "Received",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  superseded: "Revised",
};

const customerQuoteStatusBadgeMap: Record<string, BadgeStatus> = {
  draft: "pending",
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  expired: "disabled",
  superseded: "pending",
};

function getCustomerQuoteStatusLabel(status: string | undefined) {
  if (!status) {
    return "No quote yet";
  }

  return customerQuoteStatusLabels[status.toLowerCase()] ?? "In progress";
}

function mapCustomerQuoteStatusToBadge(status: string): BadgeStatus {
  return customerQuoteStatusBadgeMap[status.toLowerCase()] ?? "pending";
}

function isCustomerQuoteStatusClickable(status: string) {
  return ["sent", "accepted", "declined", "expired", "superseded"].includes(
    status.toLowerCase()
  );
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

  const requestQuoteButton = (
    <Link href="/quotes/request">
      <Button>Request a quote</Button>
    </Link>
  );

  return (
    <AppShell userRole="customer" userName={fullName} companyName={companyName}>
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
          <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-sm ring-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50/50">
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Project
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Submitted
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Requested deadline
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Fulfilment
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Deadline status
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Request status
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Quote status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {quoteRequests.map((request) => {
                      const linkedQuote = quoteByRequestId.get(request.id);
                      const quoteStatusLabel = getCustomerQuoteStatusLabel(
                        linkedQuote?.status
                      );
                      const quoteStatusIsClickable = linkedQuote
                        ? isCustomerQuoteStatusClickable(linkedQuote.status)
                        : false;

                      return (
                      <tr
                        key={request.id}
                        className="border-b border-neutral-200 last:border-0 hover:bg-neutral-50 cursor-pointer"
                      >
                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 font-medium text-neutral-950"
                          >
                            {request.project_name}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {formatDate(request.created_at)}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/quotes/${request.id}`}
                            className="block p-4 text-neutral-600"
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
                            className="block p-4 text-neutral-600"
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
                                  linkedQuote.status
                                )}
                                label={quoteStatusLabel}
                              />
                            </Link>
                          ) : (
                            <span className="text-neutral-600">
                              {quoteStatusLabel}
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
