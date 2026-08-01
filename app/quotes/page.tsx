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
  project_name: string;
  created_at: string;
  required_date: string;
  required_time: string | null;
  fulfillment_type: string;
  status: string;
};

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const requestStatuses: BadgeStatus[] = [
  "pending",
  "approved",
  "disabled",
  "draft",
  "sent",
  "accepted",
  "declined",
];

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDeadline(requiredDate: string, requiredTime: string | null) {
  const formattedDate = formatDate(requiredDate);

  if (!requiredTime) {
    return formattedDate;
  }

  return `${formattedDate}, ${requiredTime}`;
}

function getDeadlineStatus(requiredDate: string): {
  status: BadgeStatus;
  label: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadline = new Date(requiredDate);
  deadline.setHours(0, 0, 0, 0);

  if (deadline < today) {
    return { status: "declined", label: "Overdue" };
  }

  if (deadline.getTime() === today.getTime()) {
    return { status: "pending", label: "Due today" };
  }

  return { status: "approved", label: "Upcoming" };
}

function mapRequestStatus(status: string): BadgeStatus {
  if (requestStatuses.includes(status as BadgeStatus)) {
    return status as BadgeStatus;
  }

  return "draft";
}

function formatFulfillmentType(fulfillmentType: string) {
  return fulfillmentType === "collection" ? "Collection" : "Delivery";
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

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  let quoteRequests: QuoteRequest[] = [];

  if (profile?.company_id) {
    const { data } = await supabase
      .from("quote_requests")
      .select(
        "id, project_name, created_at, required_date, required_time, fulfillment_type, status"
      )
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false });

    quoteRequests = data ?? [];
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

        {quoteRequests.length === 0 ? (
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
                        Fulfillment
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Deadline status
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Request status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {quoteRequests.map((request) => {
                      const deadlineStatus = getDeadlineStatus(
                        request.required_date
                      );

                      return (
                        <tr
                          key={request.id}
                          className="border-b border-neutral-200 last:border-0 hover:bg-neutral-50"
                        >
                          <td className="p-4 font-medium text-neutral-950">
                            {request.project_name}
                          </td>

                          <td className="p-4 text-neutral-600">
                            {formatDate(request.created_at)}
                          </td>

                          <td className="p-4 text-neutral-600">
                            {formatDeadline(
                              request.required_date,
                              request.required_time
                            )}
                          </td>

                          <td className="p-4 text-neutral-600">
                            {formatFulfillmentType(request.fulfillment_type)}
                          </td>

                          <td className="p-4">
                            <StatusBadge
                              status={deadlineStatus.status}
                              label={deadlineStatus.label}
                            />
                          </td>

                          <td className="p-4">
                            <StatusBadge
                              status={mapRequestStatus(request.status)}
                            />
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
