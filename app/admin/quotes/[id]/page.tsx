import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CreateQuoteVersionButton } from "@/components/create-quote-version-button";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  QuoteBuilderForm,
  type QuoteBuilderInitialValues,
} from "@/components/quote-builder-form";
import {
  QuoteVersionSelector,
  type QuoteVersionOption,
} from "@/components/quote-version-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
};

function formatQuotePageTitle(projectName: string) {
  return projectName.replace(/^Hi\s+/i, "");
}

export default async function QuoteDetailPage({
  params,
  searchParams,
}: QuoteDetailPageProps) {
  const { id } = await params;
  const { version: versionParam } = await searchParams;
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

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, company_id, quote_request_id, project_name, status, current_version, created_by, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (quoteError || !quote) {
    notFound();
  }

  const { data: allVersions, error: versionsError } = await supabase
    .from("quote_versions")
    .select(
      "id, version_number, version_status, created_at, expiry_date, payment_terms_days, introduction, customer_notes, internal_notes, subtotal, vat_rate, vat_amount, total"
    )
    .eq("quote_id", quote.id)
    .order("version_number", { ascending: false });

  if (versionsError || !allVersions || allVersions.length === 0) {
    notFound();
  }

  const parsedVersionParam = versionParam
    ? Number.parseInt(versionParam, 10)
    : quote.current_version;

  const selectedVersionNumber = Number.isFinite(parsedVersionParam)
    ? parsedVersionParam
    : quote.current_version;

  const quoteVersion = allVersions.find(
    (version) => version.version_number === selectedVersionNumber
  );

  if (!quoteVersion) {
    notFound();
  }

  const { data: quoteItems } = await supabase
    .from("quote_items")
    .select(
      "id, title, description, quantity, unit_price, is_optional, line_total, sort_order"
    )
    .eq("quote_version_id", quoteVersion.id)
    .order("sort_order", { ascending: true });

  const [{ data: companies }, { data: quoteRequests }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
    supabase
      .from("quote_requests")
      .select("id, company_id, project_name")
      .order("created_at", { ascending: false }),
  ]);

  const initialValues: QuoteBuilderInitialValues = {
    companyId: quote.company_id,
    quoteRequestId: quote.quote_request_id,
    projectName: quote.project_name,
    expiryDate: quoteVersion.expiry_date ?? "",
    paymentTermsDays: quoteVersion.payment_terms_days ?? 14,
    introduction: quoteVersion.introduction ?? "",
    customerNotes: quoteVersion.customer_notes ?? "",
    internalNotes: quoteVersion.internal_notes ?? "",
    lineItems: (quoteItems ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      isOptional: Boolean(item.is_optional),
    })),
  };

  const canEdit = quoteVersion.version_status === "draft";
  const versionOptions: QuoteVersionOption[] = allVersions.map((version) => ({
    version_number: version.version_number,
    version_status: version.version_status,
    created_at: version.created_at,
  }));

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title={formatQuotePageTitle(quote.project_name)}
          description={`Quote Q-${quote.quote_number}`}
          actions={
            <Link href="/admin/quotes">
              <Button variant="outline">Back to quotes</Button>
            </Link>
          }
        />

        <Card className="mb-6 rounded-2xl border-neutral-200 shadow-sm ring-0">
          <CardContent className="space-y-4 pt-6">
            <QuoteVersionSelector
              quoteId={quote.id}
              versions={versionOptions}
              selectedVersion={selectedVersionNumber}
              selectedVersionStatus={quoteVersion.version_status}
              currentVersion={quote.current_version}
            />

            <CreateQuoteVersionButton
              quoteId={quote.id}
              sourceVersion={{
                id: quoteVersion.id,
                version_number: quoteVersion.version_number,
                introduction: quoteVersion.introduction,
                customer_notes: quoteVersion.customer_notes,
                internal_notes: quoteVersion.internal_notes,
                expiry_date: quoteVersion.expiry_date,
                payment_terms_days: quoteVersion.payment_terms_days,
                subtotal: quoteVersion.subtotal,
                vat_rate: quoteVersion.vat_rate,
                vat_amount: quoteVersion.vat_amount,
                total: quoteVersion.total,
              }}
              sourceItems={(quoteItems ?? []).map((item) => ({
                title: item.title,
                description: item.description,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price),
                is_optional: Boolean(item.is_optional),
                line_total: Number(item.line_total),
                sort_order: Number(item.sort_order),
              }))}
            />
          </CardContent>
        </Card>

        <QuoteBuilderForm
          key={quoteVersion.id}
          mode="edit"
          createdBy={user.id}
          companies={companies ?? []}
          quoteRequests={quoteRequests ?? []}
          initialValues={initialValues}
          quoteId={quote.id}
          selectedQuoteVersionId={quoteVersion.id}
          quoteNumber={quote.quote_number}
          quoteStatus={quote.status}
          versionStatus={quoteVersion.version_status}
          selectedVersionNumber={selectedVersionNumber}
          currentVersionNumber={quote.current_version}
          canEdit={canEdit}
        />
      </div>
    </AppShell>
  );
}
