import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { InviteCustomerDialog } from "@/components/invite-customer-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatPaymentTermsLabel } from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/server";
import { buildLoginUrl } from "@/lib/auth-redirect";

type CustomerProfile = {
  id: string;
  full_name: string | null;
  requested_company_name: string | null;
  account_status: string;
  user_role: string;
  created_at: string;
  company_id: string | null;
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
  admin: "sent",
  customer: "draft",
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

export default async function AdminCustomersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/admin/customers"));
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
    .from("profiles")
    .select(
      "id, full_name, requested_company_name, account_status, user_role, created_at, company_id"
    )
    .order("created_at", { ascending: false });

  const customers: CustomerProfile[] = data ?? [];
  const queryError = error?.message ?? null;
  const isDevelopment = process.env.NODE_ENV === "development";

  const companyIds = [
    ...new Set(
      customers
        .map((customer) => customer.company_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const { data: companies } =
    companyIds.length > 0
      ? await supabase
          .from("companies")
          .select("id, company_name, payment_terms_days")
          .in("id", companyIds)
      : { data: [] as { id: string; company_name: string; payment_terms_days: number | null }[] };

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );

  const companyPaymentTermsById = new Map(
    (companies ?? []).map((company) => [company.id, company.payment_terms_days])
  );

  const { data: inviteCompanies } = await supabase
    .from("companies")
    .select("id, company_name")
    .eq("is_active", true)
    .order("company_name");

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Customers"
          description="View registered portal users and their account status."
          actions={
            <InviteCustomerDialog companies={inviteCompanies ?? []} />
          }
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
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Registered portal users will appear here."
          />
        ) : (
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Requested company</th>
                      <th>Linked company</th>
                      <th>Payment terms</th>
                      <th>Account status</th>
                      <th>Role</th>
                      <th>Registered</th>
                    </tr>
                  </thead>

                  <tbody>
                    {customers.map((customer) => (
                      <tr key={customer.id}>
                        <td className="px-4 py-3.5 font-medium text-foreground">
                          {customer.full_name || "Unnamed user"}
                        </td>

                        <td className="px-4 py-3.5 text-muted-foreground">
                          {customer.requested_company_name || "—"}
                        </td>

                        <td className="px-4 py-3.5">
                          {customer.company_id ? (
                            <Link
                              href={`/admin/companies/${customer.company_id}`}
                              className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
                            >
                              {companyNameById.get(customer.company_id) ||
                                "Unknown company"}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-muted-foreground">
                          {customer.company_id
                            ? formatPaymentTermsLabel(
                                companyPaymentTermsById.get(customer.company_id)
                              )
                            : "—"}
                        </td>

                        <td className="px-4 py-3.5">
                          <StatusBadge
                            status={mapToBadgeStatus(customer.account_status)}
                            label={formatStatusLabel(customer.account_status)}
                          />
                        </td>

                        <td className="px-4 py-3.5">
                          <StatusBadge
                            status={mapToBadgeStatus(customer.user_role)}
                            label={formatStatusLabel(customer.user_role)}
                          />
                        </td>

                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatDate(customer.created_at)}
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
