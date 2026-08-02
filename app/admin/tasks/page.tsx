import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { TaskAssigneeDisplay } from "@/components/crm/task-assignee-display";
import { TaskPriorityBadge } from "@/components/crm/task-badges";
import { TaskStatusToggle } from "@/components/crm/task-status-toggle";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import {
  buildTasksListHref,
  fetchTasksList,
  formatTaskListViewLabel,
  hasActiveTasksListFilters,
  parseTasksListFilters,
  TASK_LIST_VIEW_OPTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TasksListSearchParams,
} from "@/lib/crm/tasks-list";
import {
  formatTaskPriorityLabel,
  formatTaskStatusLabel,
} from "@/lib/crm/task-config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminTasksPageProps = {
  searchParams: Promise<TasksListSearchParams>;
};

export default async function AdminTasksPage({
  searchParams,
}: AdminTasksPageProps) {
  const rawSearchParams = await searchParams;
  const filters = parseTasksListFilters(rawSearchParams);
  const hasFilters = hasActiveTasksListFilters(filters);

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/tasks");
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? "";

  const [
    { tasks, totalCount, queryError },
    { data: activeCompanies },
    { data: opportunities },
    crmStaff,
  ] = await Promise.all([
    fetchTasksList(supabase, filters, currentUserId),
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
    supabase
      .from("opportunities")
      .select("id, title")
      .order("updated_at", { ascending: false })
      .limit(200),
    loadCrmStaffProfiles(supabase),
  ]);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title="Tasks"
          description="Follow-ups and actions linked to opportunities and quotes."
          actions={
            <Link href="/admin/tasks/new">
              <Button>New task</Button>
            </Link>
          }
        />

        <div className="mb-6 flex flex-wrap gap-2">
          {TASK_LIST_VIEW_OPTIONS.map((view) => (
            <Link key={view} href={buildTasksListHref(filters, { view })}>
              <Button
                variant={filters.view === view ? "default" : "outline"}
                size="sm"
              >
                {formatTaskListViewLabel(view)}
              </Button>
            </Link>
          ))}
        </div>

        <Card className="portal-surface mb-6">
          <CardContent className="pt-6">
            <form
              method="get"
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-6"
            >
              {filters.view !== "my" ? (
                <input type="hidden" name="view" value={filters.view} />
              ) : null}

              <div className="space-y-2 md:col-span-2 xl:col-span-2">
                <Label htmlFor="search">Search</Label>
                <Input
                  id="search"
                  name="search"
                  type="search"
                  placeholder="Search tasks…"
                  defaultValue={filters.search}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assignee">Assignee</Label>
                <Select
                  id="assignee"
                  name="assignee"
                  defaultValue={filters.assigneeId ?? ""}
                >
                  <option value="">All assignees</option>
                  {crmStaff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name?.trim() || "Unnamed staff member"}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  name="status"
                  defaultValue={filters.status ?? ""}
                >
                  <option value="">All statuses</option>
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatTaskStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  id="priority"
                  name="priority"
                  defaultValue={filters.priority ?? ""}
                >
                  <option value="">All priorities</option>
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {formatTaskPriorityLabel(priority)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="due">Due date</Label>
                <Input
                  id="due"
                  name="due"
                  type="date"
                  defaultValue={filters.dueDate ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Select
                  id="company"
                  name="company"
                  defaultValue={filters.companyId ?? ""}
                >
                  <option value="">All companies</option>
                  {(activeCompanies ?? []).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="opportunity">Opportunity</Label>
                <Select
                  id="opportunity"
                  name="opportunity"
                  defaultValue={filters.opportunityId ?? ""}
                >
                  <option value="">All opportunities</option>
                  {(opportunities ?? []).map((opportunity) => (
                    <option key={opportunity.id} value={opportunity.id}>
                      {opportunity.title}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-6">
                <Button type="submit">Apply filters</Button>
                {hasFilters ? (
                  <Link href="/admin/tasks">
                    <Button type="button" variant="outline">
                      Clear
                    </Button>
                  </Link>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        {queryError ? (
          <Card className="portal-surface mb-6 border-destructive/30">
            <CardContent className="py-6 text-sm text-destructive">
              Unable to load tasks: {queryError}
            </CardContent>
          </Card>
        ) : null}

        {tasks.length === 0 ? (
          <Card className="portal-surface">
            <CardContent className="py-12">
              <EmptyState
                title="No tasks found"
                description={
                  hasFilters
                    ? "Try adjusting your search or filters."
                    : "Create a task to track follow-ups and actions."
                }
                action={
                  hasFilters ? undefined : (
                    <Link href="/admin/tasks/new">
                      <Button>New task</Button>
                    </Link>
                  )
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="portal-surface overflow-hidden">
            <div className="border-b border-border px-6 py-4 text-sm text-muted-foreground">
              {totalCount === 1 ? "1 task" : `${totalCount} tasks`}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Task</th>
                    <th className="px-6 py-3 font-medium">Opportunity</th>
                    <th className="px-6 py-3 font-medium">Company</th>
                    <th className="px-6 py-3 font-medium">Assigned staff</th>
                    <th className="px-6 py-3 font-medium">Due</th>
                    <th className="px-6 py-3 font-medium">Priority</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-border/70 align-top"
                    >
                      <td className="px-6 py-4 font-medium">{task.title}</td>
                      <td className="px-6 py-4">
                        {task.opportunity_id ? (
                          <Link
                            href={`/admin/opportunities/${task.opportunity_id}`}
                            className="hover:underline"
                          >
                            {task.opportunity_title}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4">{task.company_name ?? "—"}</td>
                      <td className="px-6 py-4">
                        <TaskAssigneeDisplay assignees={task.assignees} />
                      </td>
                      <td className="px-6 py-4">
                        {formatCrmDateTime(task.due_at)}
                      </td>
                      <td className="px-6 py-4">
                        <TaskPriorityBadge priority={task.priority} />
                      </td>
                      <td className="px-6 py-4">
                        <TaskStatusToggle
                          taskId={task.id}
                          status={task.status}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/tasks/${task.id}/edit`}
                          className="font-medium hover:underline"
                        >
                          View/edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
