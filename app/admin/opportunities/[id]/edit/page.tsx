import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { DeleteOpportunitySection } from "@/components/crm/delete-opportunity-section";
import { OpportunityForm } from "@/components/crm/opportunity-form";
import { PageHeader } from "@/components/page-header";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { getOpportunityDeletionBlockers } from "@/lib/crm/opportunity-delete";
import { buildOpportunityFormInitialValues } from "@/lib/crm/opportunity-form-values";
import {
  loadOpportunityCollaboratorIds,
} from "@/lib/crm/opportunity-detail";
import { isAdminRole } from "@/lib/staff-roles";
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

  const [{ data: companies }, { data: company }, crmStaff, collaboratorIds, deletionBlockers] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
      supabase
        .from("companies")
        .select("company_name")
        .eq("id", opportunity.company_id)
        .maybeSingle(),
      loadCrmStaffProfiles(supabase),
      loadOpportunityCollaboratorIds(supabase, id),
      getOpportunityDeletionBlockers(supabase, id),
    ]);

  const initialValues = buildOpportunityFormInitialValues(
    opportunity,
    collaboratorIds
  );
  const canPermanentlyDelete = isAdminRole(profile.user_role);

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

        {canPermanentlyDelete ? (
          <DeleteOpportunitySection
            opportunityId={id}
            opportunityTitle={opportunity.title}
            companyName={company?.company_name ?? "Unknown company"}
            canDelete={deletionBlockers.canDelete}
            blockReason={deletionBlockers.blockReason}
            blockingTasks={deletionBlockers.blockingTasks}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
