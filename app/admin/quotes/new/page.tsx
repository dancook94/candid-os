import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { NewQuoteBuilderShell } from "@/components/crm/new-quote-builder-shell";
import { PageHeader } from "@/components/page-header";
import {
  QuoteBuilderForm,
  type QuoteBuilderInitialValues,
} from "@/components/quote-builder-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  parsePaymentTermsDays,
  resolveQuotePaymentTermsDays,
} from "@/lib/payment-terms";
import { computeDefaultQuoteExpiryDate } from "@/lib/app-settings";
import { loadAppSettings } from "@/lib/app-settings-server";
import { loadQuoteContactDisplay } from "@/lib/crm/quote-contact-display";
import { findQuoteRequestIdForOpportunity } from "@/lib/quote-request-link";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

type NewQuotePageProps = {
  searchParams: Promise<{
    quoteRequestId?: string;
    opportunityId?: string;
    companyId?: string;
    contactId?: string;
  }>;
};

function buildCustomerNotes(description: string, notes: string | null) {
  return [description.trim(), notes?.trim()].filter(Boolean).join("\n\n");
}

export default async function NewQuotePage({ searchParams }: NewQuotePageProps) {
  const { quoteRequestId, opportunityId, companyId: prefilledCompanyId, contactId: prefilledContactId } =
    await searchParams;
  const supabase = await createClient();
  const loginPath = opportunityId
    ? `/admin/quotes/new?opportunityId=${encodeURIComponent(opportunityId)}`
    : quoteRequestId
      ? `/admin/quotes/new?quoteRequestId=${encodeURIComponent(quoteRequestId)}`
      : "/admin/quotes/new";
  const profile = await requireAdminPageAccess(supabase, loginPath);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: companies }, { data: quoteRequests }, { data: opportunities }, appSettingsResult] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id, company_name, payment_terms_days")
        .eq("is_active", true)
        .order("company_name"),
      supabase
        .from("quote_requests")
        .select("id, company_id, project_name, opportunity_id")
        .order("created_at", { ascending: false }),
      supabase
        .from("opportunities")
        .select("id, title, company_id, contact_id")
        .not("stage", "in", '("won","lost")')
        .order("updated_at", { ascending: false })
        .limit(200),
      loadAppSettings(supabase),
    ]);

  const appSettings = appSettingsResult.settings;

  let initialValues: QuoteBuilderInitialValues = {
    companyId: "",
    contactId: null,
    quoteRequestId: null,
    opportunityId: null,
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
      .select("id, company_id, project_name, description, notes, opportunity_id")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (quoteRequest) {
      const linkedCompany = (companies ?? []).find(
        (company) => company.id === quoteRequest.company_id
      );

      initialValues = {
        companyId: quoteRequest.company_id,
        contactId: null,
        quoteRequestId: quoteRequest.id,
        opportunityId: quoteRequest.opportunity_id,
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

  if (opportunityId) {
    const { data: opportunity } = await supabase
      .from("opportunities")
      .select("id, company_id, contact_id, title, description")
      .eq("id", opportunityId)
      .maybeSingle();

    if (opportunity) {
      if (!opportunity.contact_id) {
        return (
          <AppShell {...(await buildAdminAppShellProps(supabase, profile))}>
            <div className="mx-auto max-w-3xl">
              <PageHeader
                eyebrow="Administration"
                title="Contact required"
                description="This opportunity needs a contact before a quote can be created."
                actions={
                  <Link href={`/admin/opportunities/${opportunityId}`}>
                    <Button variant="outline">Back to opportunity</Button>
                  </Link>
                }
              />
              <Card className="portal-surface border-amber-400/50 bg-amber-50">
                <CardContent className="pt-6">
                  <p className="text-sm text-amber-800">
                    Add a contact to this opportunity before creating a quote.
                  </p>
                </CardContent>
              </Card>
            </div>
          </AppShell>
        );
      }

      const linkedCompany = (companies ?? []).find(
        (company) => company.id === opportunity.company_id
      );
      const contact = await loadQuoteContactDisplay(
        supabase,
        opportunity.contact_id
      );
      const linkedQuoteRequestId = await findQuoteRequestIdForOpportunity(
        supabase,
        {
          opportunityId: opportunity.id,
          companyId: opportunity.company_id,
        }
      );

      initialValues = {
        ...initialValues,
        companyId: opportunity.company_id,
        contactId: opportunity.contact_id,
        opportunityId: opportunity.id,
        quoteRequestId: linkedQuoteRequestId ?? initialValues.quoteRequestId,
        projectName: opportunity.title,
        paymentTermsDays: resolveQuotePaymentTermsDays(
          linkedCompany?.payment_terms_days,
          appSettings.default_payment_terms_days
        ),
        customerNotes: buildCustomerNotes(
          opportunity.description ?? "",
          initialValues.customerNotes
        ),
      };

      const shellProps = await buildAdminAppShellProps(supabase, profile);

      return (
        <AppShell {...shellProps}>
          <div className="mx-auto max-w-5xl">
            <PageHeader
              eyebrow="Administration"
              title="New quote"
              description="Build a draft quote for a customer."
              actions={
                <Link href={`/admin/opportunities/${opportunityId}`}>
                  <Button variant="outline">Back to opportunity</Button>
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
              lockCompany
              lockContact
              inheritedContactLabel={
                contact
                  ? [contact.full_name, contact.job_title, contact.email]
                      .filter(Boolean)
                      .join(" · ")
                  : null
              }
            />
          </div>
        </AppShell>
      );
    }
  }

  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const useDirectBuilder = Boolean(
    opportunityId || quoteRequestId || (prefilledCompanyId && prefilledContactId)
  );

  if (prefilledCompanyId && prefilledContactId && !opportunityId && !quoteRequestId) {
    const linkedCompany = (companies ?? []).find(
      (company) => company.id === prefilledCompanyId
    );
    const contact = await loadQuoteContactDisplay(
      supabase,
      prefilledContactId
    );

    initialValues = {
      ...initialValues,
      companyId: prefilledCompanyId,
      contactId: prefilledContactId,
      paymentTermsDays: resolveQuotePaymentTermsDays(
        linkedCompany?.payment_terms_days,
        appSettings.default_payment_terms_days
      ),
    };

    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="Administration"
            title="New quote"
            description="Build a draft quote for a customer."
            actions={
              <Link href={`/admin/companies/${prefilledCompanyId}`}>
                <Button variant="outline">Back to company</Button>
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
            lockCompany
            inheritedContactLabel={
              contact
                ? [contact.full_name, contact.job_title, contact.email]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title="New quote"
          description="Build a draft quote for a customer."
          actions={
            opportunityId ? (
              <Link href={`/admin/opportunities/${opportunityId}`}>
                <Button variant="outline">Back to opportunity</Button>
              </Link>
            ) : (
              <Link href="/admin/quotes">
                <Button variant="outline">Back to quotes</Button>
              </Link>
            )
          }
        />

        {useDirectBuilder ? (
          <QuoteBuilderForm
            mode="create"
            createdBy={user!.id}
            companies={companies ?? []}
            quoteRequests={quoteRequests ?? []}
            initialValues={initialValues}
            fallbackQuotePaymentTermsDays={appSettings.default_payment_terms_days}
          />
        ) : (
          <NewQuoteBuilderShell
            createdBy={user!.id}
            companies={companies ?? []}
            quoteRequests={quoteRequests ?? []}
            opportunities={opportunities ?? []}
            initialValues={initialValues}
            fallbackQuotePaymentTermsDays={appSettings.default_payment_terms_days}
          />
        )}
      </div>
    </AppShell>
  );
}
