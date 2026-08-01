import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";

type QuoteRequestRow = {
  id: string;
  company_id: string;
  requested_by: string;
  project_name: string;
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
  reviewing: "pending",
  quoted: "accepted",
  cancelled: "declined",
  alternative_proposed: "sent",
};

const REQUEST_STATUS_OPTIONS = [
  "submitted",
  "reviewing",
  "quoted",
  "cancelled",
] as const;

const DEADLINE_STATUS_OPTIONS = [
  "pending",
  "approved",
  "alternative_proposed",
  "declined",
] as const;

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

type AdminQuoteRequestsPageProps = {
  searchParams: Promise<{
    q?: string;
    request_status?: string;
    deadline_status?: string;
  }>;
};

export default async function AdminQuoteRequestsPage({
  searchParams,
}: AdminQuoteRequestsPageProps) {
  const { q, request_status: requestStatusFilter, deadline_status: deadlineStatusFilter } =
    await searchParams;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
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

  let query = supabase
    .from("quote_requests")
    .select(
      "id, company_id, requested_by, project_name, fulfilment_method, requested_date, requested_time, deadline_status, request_status, created_at"
    )
    .order("created_at", { ascending: false });

  if (requestStatusFilter) {
    query = query.eq("request_status", requestStatusFilter);
  }

  if (deadlineStatusFilter) {
    query = query.eq("deadline_status", deadlineStatusFilter);
  }

  const { data, error } = await query;

  const quoteRequests: QuoteRequestRow[] = data ?? [];
  const queryError = error?.message ?? null;
  const isDevelopment = process.env.NODE_ENV === "development";

  const companyIds = [...new Set(quoteRequests.map((row) => row.company_id))];
  const requesterIds = [...new Set(quoteRequests.map((row) => row.requested_by))];

  const [{ data: companies }, { data: requesters }] = await Promise.all([
    companyIds.length > 0
      ? supabase
          .from("companies")
          .select("id, company_name")
          .in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; company_name: string }[] }),
    requesterIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", requesterIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ]);

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );

  const requesterNameById = new Map(
    (requesters ?? []).map((requester) => [
      requester.id,
      requester.full_name || "Unknown requester",
    ])
  );

  const requestIds = quoteRequests.map((request) => request.id);

  const { data: linkedQuotes } =
    requestIds.length > 0
      ? await supabase
          .from("quotes")
          .select("id, quote_request_id, status, quote_number")
          .in("quote_request_id", requestIds)
          .order("updated_at", { ascending: false })
      : { data: [] as { id: string; quote_request_id: string | null; status: string; quote_number: number }[] };

  const quoteByRequestId = new Map<
    string,
    { id: string; status: string; quote_number: number }
  >();

  for (const quote of linkedQuotes ?? []) {
    if (quote.quote_request_id && !quoteByRequestId.has(quote.quote_request_id)) {
      quoteByRequestId.set(quote.quote_request_id, {
        id: quote.id,
        status: quote.status,
        quote_number: quote.quote_number,
      });
    }
  }

  const searchQuery = q?.trim().toLowerCase() ?? "";

  const filteredQuoteRequests = searchQuery
    ? quoteRequests.filter((request) => {
        const companyName =
          companyNameById.get(request.company_id)?.toLowerCase() ?? "";
        return (
          request.project_name.toLowerCase().includes(searchQuery) ||
          companyName.includes(searchQuery)
        );
      })
    : quoteRequests;

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Quote requests"
          description="Review incoming customer quote requests."
        />

        <Card className="mb-6 rounded-2xl border-neutral-200 shadow-sm ring-0">
          <CardContent className="pt-6">
            <form method="get" className="grid gap-4 lg:grid-cols-4">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="q">Search</Label>
                <Input
                  id="q"
                  name="q"
                  type="search"
                  placeholder="Project or company name"
                  defaultValue={q ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="request_status">Request status</Label>
                <select
                  id="request_status"
                  name="request_status"
                  defaultValue={requestStatusFilter ?? ""}
                  className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10"
                >
                  <option value="">All request statuses</option>
                  {REQUEST_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deadline_status">Deadline status</Label>
                <select
                  id="deadline_status"
                  name="deadline_status"
                  defaultValue={deadlineStatusFilter ?? ""}
                  className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10"
                >
                  <option value="">All deadline statuses</option>
                  {DEADLINE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2 lg:col-span-4">
                <Button type="submit">Apply filters</Button>
                {(q || requestStatusFilter || deadlineStatusFilter) && (
                  <Link href="/admin/quote-requests">
                    <Button type="button" variant="outline">
                      Clear
                    </Button>
                  </Link>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {isDevelopment && queryError ? (
          <Card className="rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-red-800">
                Supabase query error
              </p>
              <p className="mt-2 text-sm text-red-700">{queryError}</p>
            </CardContent>
          </Card>
        ) : filteredQuoteRequests.length === 0 ? (
          <EmptyState
            title="No quote requests found"
            description={
              q || requestStatusFilter || deadlineStatusFilter
                ? "Try adjusting your filters or search query."
                : "Customer quote requests will appear here once submitted."
            }
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
                        Company
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Requested by
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
                    {filteredQuoteRequests.map((request) => {
                      const linkedQuote = quoteByRequestId.get(request.id);

                      return (
                      <tr
                        key={request.id}
                        className="cursor-pointer border-b border-neutral-200 last:border-0 hover:bg-neutral-50"
                      >
                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 font-medium text-neutral-950"
                          >
                            {request.project_name}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {companyNameById.get(request.company_id) ||
                              "Unknown company"}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {requesterNameById.get(request.requested_by) ||
                              "Unknown requester"}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {formatDate(request.created_at)}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
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
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {formatFulfilmentMethod(request.fulfilment_method)}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
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
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4"
                          >
                            <StatusBadge
                              status={mapRequestStatusToBadge(request.request_status)}
                              label={formatStatusLabel(request.request_status)}
                            />
                          </Link>
                        </td>

                        <td className="p-0">
                          {linkedQuote ? (
                            <Link
                              href={`/admin/quotes/${linkedQuote.id}`}
                              className="block p-4"
                            >
                              <StatusBadge
                                status={mapQuoteStatusToBadge(linkedQuote.status)}
                                label={formatStatusLabel(linkedQuote.status)}
                              />
                            </Link>
                          ) : (
                            <span className="block p-4 text-neutral-500">
                              No quote yet
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
