import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  QuoteBuilderForm,
  type QuoteBuilderInitialValues,
} from "@/components/quote-builder-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params;
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

  const { data: quoteVersion, error: versionError } = await supabase
    .from("quote_versions")
    .select(
      "id, version_number, version_status, expiry_date, payment_terms_days, introduction, customer_notes, internal_notes, subtotal, vat_amount, total"
    )
    .eq("quote_id", quote.id)
    .eq("version_number", quote.current_version)
    .maybeSingle();

  if (versionError || !quoteVersion) {
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

  const canEdit = quote.status === "draft";

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Administration"
          title={`Quote Q-${quote.quote_number}`}
          description={quote.project_name}
          actions={
            <Link href="/admin/quotes">
              <Button variant="outline">Back to quotes</Button>
            </Link>
          }
        />

        <QuoteBuilderForm
          mode="edit"
          createdBy={user.id}
          companies={companies ?? []}
          quoteRequests={quoteRequests ?? []}
          initialValues={initialValues}
          quoteId={quote.id}
          quoteVersionId={quoteVersion.id}
          quoteNumber={quote.quote_number}
          quoteStatus={quote.status}
          canEdit={canEdit}
        />
      </div>
    </AppShell>
  );
}
