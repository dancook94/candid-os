import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CompanyLogoForm } from "@/components/company-logo-form";
import { CompanyPaymentTermsForm } from "@/components/company-payment-terms-form";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createCompanyLogoSignedUrl } from "@/lib/company-logos";
import { formatPaymentTermsLabel } from "@/lib/payment-terms";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { isCandidAdminRole, resolveAdminAccessDeniedPath } from "@/lib/staff-roles";

type CompanyDetailPageProps = {
  params: Promise<{ id: string }>;
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

export default async function CompanyDetailPage({
  params,
}: CompanyDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(`/admin/companies/${id}`));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status, avatar_storage_path")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !isCandidAdminRole(profile.user_role) ||
    profile.account_status !== "approved"
  ) {
    redirect(resolveAdminAccessDeniedPath(profile?.user_role));
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select(
      "id, company_name, trading_name, accounts_email, phone, vat_number, payment_terms_days, is_active, created_at, logo_storage_path, logo_file_name, logo_file_type, logo_file_size"
    )
    .eq("id", id)
    .maybeSingle();

  if (companyError || !company) {
    notFound();
  }

  const { data: linkedCustomers, error: customersError } = await supabase
    .from("profiles")
    .select("id, full_name, account_status, user_role, created_at")
    .eq("company_id", company.id)
    .order("full_name", { ascending: true });

  const isDevelopment = process.env.NODE_ENV === "development";
  const logoPreviewUrl = company.logo_storage_path
    ? await createCompanyLogoSignedUrl(supabase, company.logo_storage_path)
    : null;
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title={company.company_name}
          description={
            company.trading_name
              ? `Trading as ${company.trading_name}`
              : "Company details and commercial settings"
          }
          actions={
            <Link href="/admin/companies">
              <Button variant="outline">Back to companies</Button>
            </Link>
          }
        />

        {isDevelopment && customersError ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">
                Linked customers query error
              </p>
              <p className="mt-2 text-sm text-red-700">{customersError.message}</p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <Card className="portal-surface overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg font-semibold">
                Company details
              </CardTitle>
              <CardDescription>
                Current payment terms:{" "}
                {formatPaymentTermsLabel(company.payment_terms_days)}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="portal-field-label">Legal name</dt>
                  <dd className="portal-detail-value">{company.company_name}</dd>
                </div>

                <div>
                  <dt className="portal-field-label">Trading name</dt>
                  <dd className="portal-detail-value">
                    {company.trading_name || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Accounts email</dt>
                  <dd className="portal-detail-value">
                    {company.accounts_email || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Phone</dt>
                  <dd className="portal-detail-value">{company.phone || "—"}</dd>
                </div>

                <div>
                  <dt className="portal-field-label">VAT number</dt>
                  <dd className="portal-detail-value">
                    {company.vat_number || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Status</dt>
                  <dd className="portal-detail-value">
                    {company.is_active ? "Active" : "Inactive"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="portal-surface overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg font-semibold">
                Commercial settings
              </CardTitle>
              <CardDescription>
                Default payment terms for new quotes created for this company.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <CompanyPaymentTermsForm
                companyId={company.id}
                initialPaymentTermsDays={company.payment_terms_days}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="portal-surface mt-6 overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">
              Portal branding
            </CardTitle>
            <CardDescription>
              This logo appears in the customer&apos;s portal. Candid branding
              remains on quotations and emails.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <CompanyLogoForm
              companyId={company.id}
              companyName={company.company_name}
              initialLogo={{
                logo_storage_path: company.logo_storage_path,
                logo_file_name: company.logo_file_name,
                logo_file_type: company.logo_file_type,
                logo_file_size: company.logo_file_size,
              }}
              initialPreviewUrl={logoPreviewUrl}
            />
          </CardContent>
        </Card>

        <Card className="portal-surface mt-6 overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">
              Linked customers
            </CardTitle>
            <CardDescription>
              Portal users assigned to this company.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {!linkedCustomers || linkedCustomers.length === 0 ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">
                No customers are linked to this company yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Account status</th>
                      <th>Role</th>
                      <th>Registered</th>
                    </tr>
                  </thead>

                  <tbody>
                    {linkedCustomers.map((customer) => (
                      <tr key={customer.id}>
                        <td className="px-4 py-3.5 font-medium text-foreground">
                          {customer.full_name || "Unnamed user"}
                        </td>

                        <td className="px-4 py-3.5">
                          <StatusBadge
                            status={
                              customer.account_status === "approved"
                                ? "approved"
                                : customer.account_status === "disabled"
                                  ? "disabled"
                                  : "pending"
                            }
                            label={formatStatusLabel(customer.account_status)}
                          />
                        </td>

                        <td className="px-4 py-3.5">
                          <StatusBadge
                            status={
                              customer.user_role === "admin" ? "sent" : "draft"
                            }
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
