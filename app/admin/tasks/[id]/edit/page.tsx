import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  buildTaskFormInitialValues,
  TaskForm,
} from "@/components/crm/task-form";
import { PageHeader } from "@/components/page-header";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { loadTaskAssigneeIds } from "@/lib/crm/task-assignees";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EditTaskPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTaskPage({ params }: EditTaskPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    `/admin/tasks/${id}/edit`
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id;

  if (!currentUserId) {
    notFound();
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !task) {
    notFound();
  }

  const [{ data: companies }, { data: opportunities }, { data: quotes }, crmStaff, assigneeProfileIds] =
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
      loadTaskAssigneeIds(supabase, id),
    ]);

  const initialValues = buildTaskFormInitialValues(task, assigneeProfileIds);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="CRM"
          title="Edit task"
          description={task.title}
        />

        <TaskForm
          mode="edit"
          taskId={id}
          crmStaff={crmStaff}
          companies={companies ?? []}
          opportunities={opportunities ?? []}
          quotes={quotes ?? []}
          currentUserId={currentUserId}
          initialValues={initialValues}
          cancelHref="/admin/tasks"
        />
      </div>
    </AppShell>
  );
}
