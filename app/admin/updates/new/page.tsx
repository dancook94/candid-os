import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProductUpdateForm } from "@/components/updates/product-update-form";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { fetchProblemReportById } from "@/lib/problem-reports/queries";
import { sanitizePublicUpdatePrefillFromReport } from "@/lib/updates/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminCreateUpdatePageProps = {
  searchParams: Promise<{ fromReport?: string }>;
};

export default async function AdminCreateUpdatePage({
  searchParams,
}: AdminCreateUpdatePageProps) {
  const { fromReport } = await searchParams;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/updates/new");
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  let initialValues = undefined;

  if (fromReport) {
    const { report } = await fetchProblemReportById(supabase, fromReport);

    if (report) {
      initialValues = sanitizePublicUpdatePrefillFromReport();
    }
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Administration"
          title="Create update"
          description="Share a customer-friendly improvement or fix with the right audience."
        />

        <ProductUpdateForm
          mode="create"
          cancelHref="/admin/updates"
          initialValues={
            initialValues
              ? {
                  title: initialValues.title,
                  body: initialValues.body,
                  category: initialValues.category,
                  audience: initialValues.audience,
                  is_published: false,
                }
              : undefined
          }
        />
      </div>
    </AppShell>
  );
}
