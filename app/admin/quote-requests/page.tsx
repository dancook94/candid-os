import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import {
  buildQuoteRequestDisplayState,
  loadLinkedQuotesByRequestIds,
} from "@/lib/quote-request-link";
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
  const profile = await requireAdminPageAccess(supabase, "/admin/quote-requests");

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

  const { quotesByRequestId, loadError: linkedQuotesLoadError } =
    await loadLinkedQuotesByRequestIds(supabase, requestIds);

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

  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Quote requests"
          description="Review incoming customer quote requests."
        />

        <Card className="portal-surface mb-6">
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
                <Select
                  id="request_status"
                  name="request_status"
                  defaultValue={requestStatusFilter ?? ""}
                >
                  <option value="">All request statuses</option>
                  {REQUEST_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deadline_status">Deadline status</Label>
                <Select
                  id="deadline_status"
                  name="deadline_status"
                  defaultValue={deadlineStatusFilter ?? ""}
                >
                  <option value="">All deadline statuses</option>
                  {DEADLINE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </Select>
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

        {isDevelopment && (queryError || linkedQuotesLoadError) ? (
          <Card className="rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-red-800">
                Supabase query error
              </p>
              <p className="mt-2 text-sm text-red-700">
                {queryError ?? linkedQuotesLoadError}
              </p>
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
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Company</th>
                      <th>Requested by</th>
                      <th>Submitted</th>
                      <th>Requested deadline</th>
                      <th>Fulfilment</th>
                      <th>Deadline status</th>
                      <th>Request status</th>
                      <th>Quote status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredQuoteRequests.map((request) => {
                      const linkedQuote = quotesByRequestId.get(request.id) ?? null;
                      const quoteDisplay = buildQuoteRequestDisplayState({
                        linkedQuote,
                        loadError: linkedQuotesLoadError,
                      });

                      return (
                      <tr
                        key={request.id}
                        className="cursor-pointer hover:bg-muted/35"
                      >
                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 font-medium text-foreground"
                          >
                            {request.project_name}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-muted-foreground"
                          >
                            {companyNameById.get(request.company_id) ||
                              "Unknown company"}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-muted-foreground"
                          >
                            {requesterNameById.get(request.requested_by) ||
                              "Unknown requester"}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-muted-foreground"
                          >
                            {formatDate(request.created_at)}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quote-requests/${request.id}`}
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
                            href={`/admin/quote-requests/${request.id}`}
                            className="block p-4 text-muted-foreground"
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
                                label={quoteDisplay.adminLabel}
                              />
                            </Link>
                          ) : quoteDisplay.kind === "load_error" ? (
                            <span className="block p-4 text-neutral-500">
                              {quoteDisplay.adminLabel}
                            </span>
                          ) : (
                            <span className="block p-4 text-neutral-500">
                              {quoteDisplay.adminLabel}
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
