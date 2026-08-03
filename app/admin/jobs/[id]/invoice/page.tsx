import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceReviewClient } from "@/components/invoice/invoice-review-client";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { buildXeroPayloadPreview, loadInvoiceReviewData } from "@/lib/invoice/service";
import { isMissingJobsSchemaError } from "@/lib/jobs/errors";
import { loadAdminJobDetail } from "@/lib/jobs/loaders";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminJobInvoicePageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminJobInvoicePage({
  params,
}: AdminJobInvoicePageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, `/admin/jobs/${id}/invoice`);
  const shellProps = await buildCrmAppShellProps(supabase, profile);
  const adminClient = createAdminClient();

  let detail: Awaited<ReturnType<typeof loadAdminJobDetail>> = null;

  try {
    detail = await loadAdminJobDetail(adminClient, id);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      isMissingJobsSchemaError(error as { code?: string; message?: string })
    ) {
      notFound();
    }

    throw error;
  }

  if (!detail) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invoiceData = await loadInvoiceReviewData(
    adminClient,
    id,
    user?.id ?? undefined
  );

  const xeroPreview = invoiceData.draft
    ? buildXeroPayloadPreview({
        companyName: detail.companyName,
        jobReference: detail.job.job_reference,
        quoteReference: detail.quoteNumber ? `Q-${detail.quoteNumber}` : null,
        purchaseOrderNumber: invoiceData.draft.purchase_order_number,
        currency: invoiceData.draft.currency,
        invoiceItems: invoiceData.invoiceItems,
        subtotal: invoiceData.draft.subtotal,
        taxTotal: invoiceData.draft.tax_total,
        total: invoiceData.draft.total,
      })
    : {
        contactName: detail.companyName,
        jobReference: detail.job.job_reference,
        quoteReference: detail.quoteNumber ? `Q-${detail.quoteNumber}` : null,
        purchaseOrderNumber: null,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        currency: "GBP",
        lineItems: [],
        subtotal: 0,
        taxTotal: 0,
        total: 0,
      };

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Invoice review"
          title={`Prepare invoice · ${detail.job.job_reference}`}
          description={`${detail.companyName} · ${detail.job.project_name}`}
          actions={
            <Link href={`/admin/jobs/${id}`}>
              <Button variant="outline">Back to job</Button>
            </Link>
          }
        />

        <InvoiceReviewClient
          jobId={id}
          jobReference={detail.job.job_reference}
          companyName={detail.companyName}
          quoteLabel={detail.quoteNumber ? `Q-${detail.quoteNumber}` : null}
          opportunityTitle={detail.opportunityTitle}
          initialData={invoiceData}
          xeroPreview={xeroPreview}
        />
      </div>
    </AppShell>
  );
}
