import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { NoteComposer } from "@/components/crm/note-composer";
import { NotesList } from "@/components/crm/notes-list";
import { DeleteTaskSection } from "@/components/crm/delete-task-section";
import { TaskForm } from "@/components/crm/task-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { getCrmNotes, getCrmTimeline } from "@/lib/crm/get-crm-timeline";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { buildTaskFormInitialValues } from "@/lib/crm/task-form-values";
import { loadTaskAssigneeIds } from "@/lib/crm/task-assignees";
import { loadTaskDeleteContext } from "@/lib/crm/task-delete";
import { isAdminRole } from "@/lib/staff-roles";
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

  const [{ data: companies }, { data: opportunities }, { data: quotes }, crmStaff, assigneeProfileIds, taskDeleteContext] =
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
      loadTaskDeleteContext(supabase, id),
    ]);

  const initialValues = buildTaskFormInitialValues(task, assigneeProfileIds);
  const isAdmin = isAdminRole(profile.user_role);
  const taskScope = {
    type: "task" as const,
    taskId: id,
    companyId: task.company_id,
    opportunityId: task.opportunity_id,
    quoteId: task.quote_id,
  };
  const [taskNotes, { items: taskActivity }] = await Promise.all([
    getCrmNotes(supabase, {
      scope: taskScope,
      currentUserId,
      isAdmin,
    }),
    getCrmTimeline(supabase, {
      scope: taskScope,
      limit: 50,
    }),
  ]);

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

        <div className="mt-8 space-y-6">
          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Task notes</CardTitle>
              <CardDescription>
                Internal notes linked to this task.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <NoteComposer
                context={{
                  companyId: task.company_id,
                  opportunityId: task.opportunity_id,
                  quoteId: task.quote_id,
                  taskId: id,
                }}
              />
              <NotesList notes={taskNotes} />
            </CardContent>
          </Card>

          <ActivityTimeline
            items={taskActivity}
            title="Task activity"
            description="Activity linked to this task."
          />
        </div>

        {isAdmin && taskDeleteContext ? (
          <DeleteTaskSection task={taskDeleteContext} />
        ) : null}
      </div>
    </AppShell>
  );
}
