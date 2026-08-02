import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminQuoteManagementActions } from "@/components/admin-quote-management-actions";
import { CreateQuoteVersionButton } from "@/components/create-quote-version-button";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { NoteComposer } from "@/components/crm/note-composer";
import { NotesList } from "@/components/crm/notes-list";
import { QuoteContactSummary } from "@/components/crm/quote-contact-summary";
import {
  loadLinkableOpportunitiesForCompany,
  loadLinkedOpportunityForQuote,
  QuoteLinkedOpportunitySection,
} from "@/components/crm/quote-linked-opportunity-section";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { getCrmNotes, getCrmTimeline } from "@/lib/crm/get-crm-timeline";
import { loadQuoteContactDisplay } from "@/lib/crm/quote-contact-display";
import { createClient } from "@/lib/supabase/server";
import { createQuoteItemImageSignedUrl } from "@/lib/quote-item-images";
import { isQuoteAwaitingDecision } from "@/lib/quote-status-response";

export const dynamic = "force-dynamic";

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
  const profile = await requireAdminPageAccess(supabase, `/admin/quotes/${id}`);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, company_id, contact_id, quote_request_id, opportunity_id, project_name, status, current_version, created_by, updated_at"
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
      "id, title, description, quantity, unit_price, is_optional, line_total, sort_order, image_storage_path, image_file_name, image_file_type, image_file_size"
    )
    .eq("quote_version_id", quoteVersion.id)
    .order("sort_order", { ascending: true });

  const lineItemsWithImages = await Promise.all(
    (quoteItems ?? []).map(async (item) => ({
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      isOptional: Boolean(item.is_optional),
      imageStoragePath: item.image_storage_path,
      imageFileName: item.image_file_name,
      imageFileType: item.image_file_type,
      imageFileSize: item.image_file_size,
      imagePreviewUrl: item.image_storage_path
        ? await createQuoteItemImageSignedUrl(supabase, item.image_storage_path)
        : null,
    }))
  );

  const [{ data: companies }, { data: quoteRequests }, linkedOpportunity, linkableOpportunities, quoteContact] =
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
    loadLinkedOpportunityForQuote(supabase, quote.opportunity_id),
    loadLinkableOpportunitiesForCompany(supabase, quote.company_id),
    loadQuoteContactDisplay(supabase, quote.contact_id),
  ]);

  const initialValues: QuoteBuilderInitialValues = {
    companyId: quote.company_id,
    contactId: quote.contact_id,
    quoteRequestId: quote.quote_request_id,
    opportunityId: quote.opportunity_id,
    projectName: quote.project_name,
    expiryDate: quoteVersion.expiry_date ?? "",
    paymentTermsDays: quoteVersion.payment_terms_days ?? 14,
    introduction: quoteVersion.introduction ?? "",
    customerNotes: quoteVersion.customer_notes ?? "",
    internalNotes: quoteVersion.internal_notes ?? "",
    lineItems: lineItemsWithImages.map(
      ({
        imageStoragePath,
        imageFileName,
        imageFileType,
        imageFileSize,
        imagePreviewUrl,
        ...item
      }) => ({
        ...item,
        imageStoragePath,
        imageFileName,
        imageFileType,
        imageFileSize,
        imagePreviewUrl,
      })
    ),
    defaultVatRate: Number(quoteVersion.vat_rate ?? 0.2),
  };

  const canEdit = quoteVersion.version_status === "draft";
  const companyName =
    (companies ?? []).find((company) => company.id === quote.company_id)
      ?.company_name ?? "Unknown company";
  const canRespondOnBehalf =
    selectedVersionNumber === quote.current_version &&
    isQuoteAwaitingDecision({
      quoteStatus: quote.status,
      versionStatus: quoteVersion.version_status,
      versionNumber: selectedVersionNumber,
      currentVersion: quote.current_version,
    });
  const versionOptions: QuoteVersionOption[] = allVersions.map((version) => ({
    version_number: version.version_number,
    version_status: version.version_status,
    created_at: version.created_at,
  }));

  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const isAdmin = ["super_admin", "admin"].includes(profile.user_role);
  const quoteScope = {
    type: "quote" as const,
    quoteId: quote.id,
    companyId: quote.company_id,
    opportunityId: quote.opportunity_id,
    contactId: quote.contact_id,
  };
  const [quoteNotes, { items: quoteActivity }] = user ?
    await Promise.all([
      getCrmNotes(supabase, {
        scope: quoteScope,
        currentUserId: user.id,
        isAdmin,
      }),
      getCrmTimeline(supabase, {
        scope: quoteScope,
        limit: 50,
      }),
    ])
  : [[], { items: [] }];

  return (
    <AppShell {...shellProps}>
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

        <Card className="portal-surface mb-6">
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
                image_storage_path: item.image_storage_path,
                image_file_name: item.image_file_name,
                image_file_type: item.image_file_type,
                image_file_size: item.image_file_size,
              }))}
            />
          </CardContent>
        </Card>

        <AdminQuoteManagementActions
          quoteId={quote.id}
          quoteNumber={quote.quote_number}
          quoteStatus={quote.status}
          versionNumber={selectedVersionNumber}
          companyName={companyName}
          total={Number(quoteVersion.total ?? 0)}
          canRespondOnBehalf={canRespondOnBehalf}
        />

        <QuoteLinkedOpportunitySection
          quoteId={quote.id}
          quoteNumber={quote.quote_number}
          companyName={companyName}
          linkableOpportunities={linkableOpportunities}
          linkedOpportunity={linkedOpportunity}
        />

        <QuoteContactSummary contact={quoteContact} />

        <QuoteBuilderForm
          key={quoteVersion.id}
          mode="edit"
          createdBy={user!.id}
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
          lockContact={Boolean(quote.opportunity_id && quote.contact_id)}
        />

        <Card className="portal-surface mb-6">
          <CardHeader>
            <CardTitle>Internal CRM notes</CardTitle>
            <CardDescription>
              Staff-only notes linked to this quote. Not visible to customers,
              PDFs, or quote emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <NoteComposer
              context={{
                companyId: quote.company_id,
                contactId: quote.contact_id,
                opportunityId: quote.opportunity_id,
                quoteId: quote.id,
              }}
            />
            <NotesList notes={quoteNotes} />
          </CardContent>
        </Card>

        <ActivityTimeline
          items={quoteActivity}
          title="Quote activity"
          description="Activity linked to this quote and related records."
        />
      </div>
    </AppShell>
  );
}
