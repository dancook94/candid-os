import Link from "next/link";
import { notFound } from "next/navigation";

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
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CompanyDetailPageProps = {
  params: Promise<{ id: string }>;
};

type CompanyRecord = {
  id: string;
  company_name: string;
  trading_name: string | null;
  accounts_email: string | null;
  phone: string | null;
  vat_number: string | null;
  payment_terms_days: number | null;
  is_active: boolean;
  created_at: string;
  logo_storage_path?: string | null;
  logo_file_name?: string | null;
  logo_file_type?: string | null;
  logo_file_size?: number | null;
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
  const profile = await requireAdminPageAccess(
    supabase,
    `/admin/companies/${id}`
  );

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const isDevelopment = process.env.NODE_ENV === "development";
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  if (companyError) {
    if (isDevelopment) {
      console.error("[admin/companies/[id]] company load failed:", companyError.message);
    }

    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="Administration"
            title="Unable to load company"
            description="The company record could not be loaded."
            actions={
              <Link href="/admin/companies">
                <Button variant="outline">Back to companies</Button>
              </Link>
            }
          />

          {isDevelopment ? (
            <Card className="portal-surface border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <p className="text-sm font-medium text-red-800">
                  Company query error
                </p>
                <p className="mt-2 text-sm text-red-700">{companyError.message}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </AppShell>
    );
  }

  if (!company) {
    notFound();
  }

  const companyRecord = company as CompanyRecord;

  const { data: linkedCustomers, error: customersError } = await supabase
    .from("profiles")
    .select("id, full_name, account_status, user_role, created_at")
    .eq("company_id", companyRecord.id)
    .order("full_name", { ascending: true });

  const logoPreviewUrl = companyRecord.logo_storage_path
    ? await createCompanyLogoSignedUrl(
        supabase,
        companyRecord.logo_storage_path
      )
    : null;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title={companyRecord.company_name}
          description={
            companyRecord.trading_name
              ? `Trading as ${companyRecord.trading_name}`
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
                {formatPaymentTermsLabel(companyRecord.payment_terms_days)}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="portal-field-label">Legal name</dt>
                  <dd className="portal-detail-value">{companyRecord.company_name}</dd>
                </div>

                <div>
                  <dt className="portal-field-label">Trading name</dt>
                  <dd className="portal-detail-value">
                    {companyRecord.trading_name || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Accounts email</dt>
                  <dd className="portal-detail-value">
                    {companyRecord.accounts_email || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Phone</dt>
                  <dd className="portal-detail-value">{companyRecord.phone || "—"}</dd>
                </div>

                <div>
                  <dt className="portal-field-label">VAT number</dt>
                  <dd className="portal-detail-value">
                    {companyRecord.vat_number || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="portal-field-label">Status</dt>
                  <dd className="portal-detail-value">
                    {companyRecord.is_active ? "Active" : "Inactive"}
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
                companyId={companyRecord.id}
                initialPaymentTermsDays={companyRecord.payment_terms_days}
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
              companyId={companyRecord.id}
              companyName={companyRecord.company_name}
              initialLogo={{
                logo_storage_path: companyRecord.logo_storage_path ?? null,
                logo_file_name: companyRecord.logo_file_name ?? null,
                logo_file_type: companyRecord.logo_file_type ?? null,
                logo_file_size: companyRecord.logo_file_size ?? null,
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
