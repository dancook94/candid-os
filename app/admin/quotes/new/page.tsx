import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  QuoteBuilderForm,
  type QuoteBuilderInitialValues,
} from "@/components/quote-builder-form";
import { Button } from "@/components/ui/button";
import {
  parsePaymentTermsDays,
  PAYMENT_TERMS_MAX_DAYS,
  PAYMENT_TERMS_MIN_DAYS,
  resolveQuotePaymentTermsDays,
} from "@/lib/payment-terms";
import { computeDefaultQuoteExpiryDate } from "@/lib/app-settings";
import { loadAppSettings } from "@/lib/app-settings-server";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

type NewQuotePageProps = {
  searchParams: Promise<{ quoteRequestId?: string }>;
};

function buildCustomerNotes(description: string, notes: string | null) {
  return [description.trim(), notes?.trim()].filter(Boolean).join("\n\n");
}

export default async function NewQuotePage({ searchParams }: NewQuotePageProps) {
  const { quoteRequestId } = await searchParams;
  const supabase = await createClient();
  const loginPath = quoteRequestId
    ? `/admin/quotes/new?quoteRequestId=${encodeURIComponent(quoteRequestId)}`
    : "/admin/quotes/new";
  const profile = await requireAdminPageAccess(supabase, loginPath);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: companies }, { data: quoteRequests }, appSettingsResult] =
    await Promise.all([
    supabase
      .from("companies")
      .select("id, company_name, payment_terms_days")
      .eq("is_active", true)
      .order("company_name"),
    supabase
      .from("quote_requests")
      .select("id, company_id, project_name")
      .order("created_at", { ascending: false }),
    loadAppSettings(supabase),
  ]);

  const appSettings = appSettingsResult.settings;

  let initialValues: QuoteBuilderInitialValues = {
    companyId: "",
    quoteRequestId: null,
    projectName: "",
    expiryDate: computeDefaultQuoteExpiryDate(appSettings.default_quote_expiry_days),
    paymentTermsDays: resolveQuotePaymentTermsDays(
      null,
      appSettings.default_payment_terms_days
    ),
    introduction: appSettings.default_introduction ?? "",
    customerNotes: appSettings.default_customer_notes ?? "",
    internalNotes: "",
    lineItems: [],
    defaultVatRate: appSettings.default_vat_rate,
  };

  if (quoteRequestId) {
    const { data: quoteRequest } = await supabase
      .from("quote_requests")
      .select("id, company_id, project_name, description, notes")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (quoteRequest) {
      const linkedCompany = (companies ?? []).find(
        (company) => company.id === quoteRequest.company_id
      );

      initialValues = {
        companyId: quoteRequest.company_id,
        quoteRequestId: quoteRequest.id,
        projectName: quoteRequest.project_name,
        expiryDate: computeDefaultQuoteExpiryDate(appSettings.default_quote_expiry_days),
        paymentTermsDays: resolveQuotePaymentTermsDays(
          linkedCompany?.payment_terms_days,
          appSettings.default_payment_terms_days
        ),
        introduction: appSettings.default_introduction ?? "",
        customerNotes: buildCustomerNotes(
          quoteRequest.description,
          quoteRequest.notes
        ),
        internalNotes: "",
        lineItems: [],
        defaultVatRate: appSettings.default_vat_rate,
      };
    }
  }

  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title="New quote"
          description="Build a draft quote for a customer."
          actions={
            <Link href="/admin/quotes">
              <Button variant="outline">Back to quotes</Button>
            </Link>
          }
        />

        <QuoteBuilderForm
          mode="create"
          createdBy={user!.id}
          companies={companies ?? []}
          quoteRequests={quoteRequests ?? []}
          initialValues={initialValues}
          fallbackQuotePaymentTermsDays={appSettings.default_payment_terms_days}
        />
      </div>
    </AppShell>
  );
}
