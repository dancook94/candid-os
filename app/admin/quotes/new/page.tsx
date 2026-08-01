import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  QuoteBuilderForm,
  type QuoteBuilderInitialValues,
} from "@/components/quote-builder-form";
import { Button } from "@/components/ui/button";
import { resolvePaymentTermsDays } from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/server";
import { buildLoginUrl } from "@/lib/auth-redirect";

type NewQuotePageProps = {
  searchParams: Promise<{ quoteRequestId?: string }>;
};

function buildCustomerNotes(description: string, notes: string | null) {
  return [description.trim(), notes?.trim()].filter(Boolean).join("\n\n");
}

export default async function NewQuotePage({ searchParams }: NewQuotePageProps) {
  const { quoteRequestId } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const nextPath = quoteRequestId
      ? `/admin/quotes/new?quoteRequestId=${encodeURIComponent(quoteRequestId)}`
      : "/admin/quotes/new";
    redirect(buildLoginUrl(nextPath));
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

  const [{ data: companies }, { data: quoteRequests }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, company_name, payment_terms_days")
      .eq("is_active", true)
      .order("company_name"),
    supabase
      .from("quote_requests")
      .select("id, company_id, project_name")
      .order("created_at", { ascending: false }),
  ]);

  let initialValues: QuoteBuilderInitialValues = {
    companyId: "",
    quoteRequestId: null,
    projectName: "",
    expiryDate: "",
    paymentTermsDays: 14,
    introduction: "",
    customerNotes: "",
    internalNotes: "",
    lineItems: [],
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
        expiryDate: "",
        paymentTermsDays: resolvePaymentTermsDays(
          linkedCompany?.payment_terms_days
        ),
        introduction: "",
        customerNotes: buildCustomerNotes(
          quoteRequest.description,
          quoteRequest.notes
        ),
        internalNotes: "",
        lineItems: [],
      };
    }
  }

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
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
          createdBy={user.id}
          companies={companies ?? []}
          quoteRequests={quoteRequests ?? []}
          initialValues={initialValues}
        />
      </div>
    </AppShell>
  );
}
