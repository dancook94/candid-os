import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type QuoteRow = {
  id: string;
  quote_number: number;
  company_id: string;
  project_name: string;
  status: string;
  current_version: number;
  updated_at: string;
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
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapToBadgeStatus(value: string): BadgeStatus {
  const mapped = statusVariantMap[value.toLowerCase()];

  if (mapped) {
    return mapped;
  }

  if (badgeStatuses.includes(value as BadgeStatus)) {
    return value as BadgeStatus;
  }

  return "draft";
}

export default async function AdminQuotesPage() {
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

  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, company_id, project_name, status, current_version, updated_at"
    )
    .order("updated_at", { ascending: false });

  const quotes: QuoteRow[] = data ?? [];
  const queryError = error?.message ?? null;
  const isDevelopment = process.env.NODE_ENV === "development";

  const companyIds = [...new Set(quotes.map((quote) => quote.company_id))];

  const { data: companies } =
    companyIds.length > 0
      ? await supabase
          .from("companies")
          .select("id, company_name")
          .in("id", companyIds)
      : { data: [] as { id: string; company_name: string }[] };

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );

  const newQuoteButton = (
    <Link href="/admin/quotes/new">
      <Button>New quote</Button>
    </Link>
  );

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Quotes"
          description="Create and manage customer quotes."
          actions={newQuoteButton}
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
        ) : quotes.length === 0 ? (
          <EmptyState
            title="No quotes yet"
            description="Create your first draft quote to get started."
            action={newQuoteButton}
          />
        ) : (
          <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-sm ring-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50/50">
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Quote
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Company
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Project
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Version
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Status
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Updated
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {quotes.map((quote) => (
                      <tr
                        key={quote.id}
                        className="cursor-pointer border-b border-neutral-200 last:border-0 hover:bg-neutral-50"
                      >
                        <td className="p-0">
                          <Link
                            href={`/admin/quotes/${quote.id}`}
                            className="block p-4 font-medium text-neutral-950"
                          >
                            Q-{quote.quote_number}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quotes/${quote.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {companyNameById.get(quote.company_id) ||
                              "Unknown company"}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quotes/${quote.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {quote.project_name}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quotes/${quote.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            v{quote.current_version}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quotes/${quote.id}`}
                            className="block p-4"
                          >
                            <StatusBadge
                              status={mapToBadgeStatus(quote.status)}
                              label={formatStatusLabel(quote.status)}
                            />
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/quotes/${quote.id}`}
                            className="block p-4 text-neutral-600"
                          >
                            {formatDate(quote.updated_at)}
                          </Link>
                        </td>
                      </tr>
                    ))}
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
