import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProductUpdateForm } from "@/components/updates/product-update-form";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { fetchProductUpdateById } from "@/lib/updates/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminEditUpdatePageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminEditUpdatePage({ params }: AdminEditUpdatePageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, `/admin/updates/${id}`);
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  const { update, error } = await fetchProductUpdateById(supabase, id);

  if (error || !update) {
    notFound();
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Administration"
          title="Edit update"
          description="Update the wording, audience, or publish state for this release note."
        />

        <ProductUpdateForm
          mode="edit"
          updateId={id}
          initialValues={update}
          cancelHref="/admin/updates"
        />
      </div>
    </AppShell>
  );
}
