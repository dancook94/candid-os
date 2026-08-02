import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Company360View } from "@/components/crm/company-360-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { createCompanyLogoSignedUrl } from "@/lib/company-logos";
import { fetchCompany360 } from "@/lib/crm/company-360";
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
      console.error(
        "[admin/companies/[id]] company load failed:",
        companyError.message
      );
    }

    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="CRM"
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

  const [logoPreviewUrl, crmData] = await Promise.all([
    companyRecord.logo_storage_path
      ? createCompanyLogoSignedUrl(
          supabase,
          companyRecord.logo_storage_path
        )
      : Promise.resolve(null),
    fetchCompany360(supabase, companyRecord.id),
  ]);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <Company360View
          company={{
            id: companyRecord.id,
            company_name: companyRecord.company_name,
            trading_name: companyRecord.trading_name,
            accounts_email: companyRecord.accounts_email,
            phone: companyRecord.phone,
            vat_number: companyRecord.vat_number,
            payment_terms_days: companyRecord.payment_terms_days,
            is_active: companyRecord.is_active,
            created_at: companyRecord.created_at,
            logoPreviewUrl,
            logo: {
              logo_storage_path: companyRecord.logo_storage_path ?? null,
              logo_file_name: companyRecord.logo_file_name ?? null,
              logo_file_type: companyRecord.logo_file_type ?? null,
              logo_file_size: companyRecord.logo_file_size ?? null,
            },
          }}
          data={crmData}
        />
      </div>
    </AppShell>
  );
}
