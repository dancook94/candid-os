import { AppShell } from "@/components/app-shell";
import { OpportunityForm } from "@/components/crm/opportunity-form";
import { PageHeader } from "@/components/page-header";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage() {
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    "/admin/opportunities/new"
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? "";

  const [{ data: companies }, crmStaff] = await Promise.all([
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
    loadCrmStaffProfiles(supabase),
  ]);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="CRM"
          title="New opportunity"
          description="Create a sales opportunity and assign ownership."
        />

        <OpportunityForm
          mode="create"
          companies={companies ?? []}
          crmStaff={crmStaff}
          currentUserId={currentUserId}
          cancelHref="/admin/opportunities"
        />
      </div>
    </AppShell>
  );
}
