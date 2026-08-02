import { AppShell } from "@/components/app-shell";
import { TaskForm } from "@/components/crm/task-form";
import { PageHeader } from "@/components/page-header";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type NewTaskPageProps = {
  searchParams: Promise<{ opportunityId?: string }>;
};

export default async function NewTaskPage({ searchParams }: NewTaskPageProps) {
  const { opportunityId } = await searchParams;
  const supabase = await createClient();
  const loginPath = opportunityId
    ? `/admin/tasks/new?opportunityId=${encodeURIComponent(opportunityId)}`
    : "/admin/tasks/new";
  const profile = await requireCrmPageAccess(supabase, loginPath);
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? "";

  let lockedCompanyId: string | null = null;

  if (opportunityId) {
    const { data: opportunity } = await supabase
      .from("opportunities")
      .select("company_id")
      .eq("id", opportunityId)
      .maybeSingle();

    lockedCompanyId = opportunity?.company_id ?? null;
  }

  const [{ data: companies }, { data: opportunities }, { data: quotes }, crmStaff] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
      supabase
        .from("opportunities")
        .select("id, title, company_id")
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase
        .from("quotes")
        .select("id, project_name, opportunity_id, quote_number")
        .not("opportunity_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(200),
      loadCrmStaffProfiles(supabase),
    ]);

  const cancelHref = opportunityId
    ? `/admin/opportunities/${opportunityId}`
    : "/admin/tasks";

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="CRM"
          title="New task"
          description="Create a follow-up or action item."
        />

        <TaskForm
          mode="create"
          crmStaff={crmStaff}
          companies={companies ?? []}
          opportunities={opportunities ?? []}
          quotes={quotes ?? []}
          currentUserId={currentUserId}
          lockedOpportunityId={opportunityId ?? null}
          lockedCompanyId={lockedCompanyId}
          cancelHref={cancelHref}
          successHref={cancelHref}
        />
      </div>
    </AppShell>
  );
}
