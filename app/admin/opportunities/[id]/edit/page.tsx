import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  buildOpportunityFormInitialValues,
  OpportunityForm,
} from "@/components/crm/opportunity-form";
import { PageHeader } from "@/components/page-header";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import {
  loadOpportunityCollaboratorIds,
} from "@/lib/crm/opportunity-detail";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EditOpportunityPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditOpportunityPage({
  params,
}: EditOpportunityPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    `/admin/opportunities/${id}/edit`
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id;

  if (!currentUserId) {
    notFound();
  }

  const { data: opportunity, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !opportunity) {
    notFound();
  }

  const [{ data: companies }, crmStaff, collaboratorIds] = await Promise.all([
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
    loadCrmStaffProfiles(supabase),
    loadOpportunityCollaboratorIds(supabase, id),
  ]);

  const initialValues = buildOpportunityFormInitialValues(
    opportunity,
    collaboratorIds
  );

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="CRM"
          title="Edit opportunity"
          description={opportunity.title}
        />

        <OpportunityForm
          mode="edit"
          opportunityId={id}
          companies={companies ?? []}
          crmStaff={crmStaff}
          currentUserId={currentUserId}
          initialValues={initialValues}
          cancelHref={`/admin/opportunities/${id}`}
        />
      </div>
    </AppShell>
  );
}
