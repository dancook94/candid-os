import Link from "next/link";

import { CrmActivityActorDisplay } from "@/components/crm/crm-activity-actor-display";
import { TaskAssigneeDisplay } from "@/components/crm/task-assignee-display";
import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { TaskPriorityBadge, TaskStatusBadge } from "@/components/crm/task-badges";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AdminDashboardCrmData } from "@/lib/crm/admin-dashboard";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import { formatGbp } from "@/lib/format-currency";
import { cn } from "@/lib/utils";

type AdminDashboardCrmProps = {
  data: AdminDashboardCrmData;
};

export function AdminDashboardCrmQuickActions() {
  return (
    <div className="mb-8 flex flex-wrap gap-2">
      <Link href="/admin/opportunities/new">
        <Button variant="outline" size="sm">
          New opportunity
        </Button>
      </Link>
      <Link href="/admin/tasks/new">
        <Button variant="outline" size="sm">
          New task
        </Button>
      </Link>
      <Link href="/admin/opportunities?view=pipeline">
        <Button variant="outline" size="sm">
          View pipeline
        </Button>
      </Link>
    </div>
  );
}

export function AdminDashboardCrmMetrics({ data }: AdminDashboardCrmProps) {
  const { metrics } = data;

  return (
    <>
      <div className="mb-5 grid gap-5 md:grid-cols-3">
        <StatCard
          label="Active opportunities"
          value={metrics.activeOpportunitiesCount}
          description="Open sales opportunities"
          href="/admin/opportunities"
        />
        <StatCard
          label="Active pipeline value"
          value={formatGbp(metrics.activePipelineValue)}
          description="Estimated open opportunity value"
          href="/admin/opportunities"
        />
        <StatCard
          label="Needs follow-up"
          value={metrics.needsFollowUpCount}
          description="Require attention"
          href="/admin/opportunities"
          accentClassName="bg-amber-400/45"
        />
      </div>

      <div className="mb-8 grid gap-5 md:grid-cols-3">
        <StatCard
          label="My open tasks"
          value={metrics.myOpenTasksCount}
          description="Assigned to you"
          href="/admin/tasks"
        />
        <StatCard
          label="Overdue tasks"
          value={metrics.overdueTasksCount}
          description="Past due and incomplete"
          href="/admin/tasks?view=overdue"
          accentClassName="bg-red-400/45"
        />
        <StatCard
          label="Due today"
          value={metrics.dueTodayTasksCount}
          description="Due during today (London)"
          href="/admin/tasks?view=today"
        />
      </div>
    </>
  );
}

export function AdminDashboardRecentActivityPanel({ data }: AdminDashboardCrmProps) {
  const { recentActivity } = data;

  if (recentActivity.length === 0) {
    return null;
  }

  return (
    <Card className="portal-surface mb-8 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
        <CardTitle className="text-lg font-semibold">
          Recent CRM activity
        </CardTitle>
        <Link
          href="/admin/activity"
          className="text-sm font-medium text-foreground hover:underline"
        >
          View all activity
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {recentActivity.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block px-6 py-4 transition-colors hover:bg-muted/30"
            >
              <p className="text-sm font-medium text-foreground">
                {item.description}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {item.actor_name ? (
                  <span className="inline-flex items-center gap-2">
                    <CrmActivityActorDisplay
                      actorProfileId={item.actor_profile_id}
                      actorName={item.actor_name}
                      actorAvatarUrl={item.actor_avatar_url}
                      size="sm"
                    />
                    <span>{item.actor_name}</span>
                  </span>
                ) : null}
                <span>{formatCrmDateTime(item.created_at)}</span>
                {item.context_label ? <span>{item.context_label}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDashboardCrmPanels({ data }: AdminDashboardCrmProps) {
  const { recentOpportunities, attentionTasks, metrics } = data;

  return (
    <div className="mb-8 grid gap-6 xl:grid-cols-2">
      <Card className="portal-surface overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
          <CardTitle className="text-lg font-semibold">
            Recent opportunities
          </CardTitle>
          <Link
            href="/admin/opportunities"
            className="text-sm font-medium text-foreground hover:underline"
          >
            View all opportunities
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentOpportunities.length === 0 ? (
            <EmptyState
              title="No active opportunities"
              description="Create an opportunity to start tracking your sales pipeline."
              action={
                <Link href="/admin/opportunities/new">
                  <Button size="sm">New opportunity</Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {recentOpportunities.map((opportunity) => (
                <Link
                  key={opportunity.id}
                  href={`/admin/opportunities/${opportunity.id}`}
                  className="block px-6 py-4 transition-colors hover:bg-muted/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {opportunity.title}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {opportunity.company_name} · {opportunity.owner_name}
                      </p>
                    </div>
                    <OpportunityStageBadge stage={opportunity.stage} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      {opportunity.estimated_value !== null
                        ? formatGbp(opportunity.estimated_value)
                        : "No estimate"}
                    </span>
                    <span>
                      Updated {formatCrmDateTime(opportunity.updated_at)}
                    </span>
                    {opportunity.next_follow_up_at ? (
                      <span>
                        Follow-up{" "}
                        {formatCrmDateTime(opportunity.next_follow_up_at)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="portal-surface overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
          <CardTitle className="text-lg font-semibold">
            Tasks requiring attention
          </CardTitle>
          <Link
            href="/admin/tasks"
            className="text-sm font-medium text-foreground hover:underline"
          >
            View all tasks
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {attentionTasks.length === 0 ? (
            <EmptyState
              title="No tasks need attention."
              description={
                metrics.myOpenTasksCount > 0
                  ? "Your open tasks are scheduled and up to date."
                  : "Create a task to track follow-ups and actions."
              }
              action={
                metrics.myOpenTasksCount === 0 ? (
                  <Link href="/admin/tasks/new">
                    <Button size="sm">New task</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {attentionTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/admin/tasks/${task.id}/edit`}
                  className={cn(
                    "block px-6 py-4 transition-colors hover:bg-muted/30",
                    task.isOverdue && "bg-red-50/40"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{task.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {task.opportunity_title ?? "No linked opportunity"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <TaskPriorityBadge priority={task.priority} />
                      <TaskStatusBadge status={task.status} />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <TaskAssigneeDisplay assignees={task.assignees} />
                    <p
                      className={cn(
                        "text-sm",
                        task.isOverdue
                          ? "font-medium text-red-700"
                          : "text-muted-foreground"
                      )}
                    >
                      {task.due_at
                        ? formatCrmDateTime(task.due_at)
                        : "No due date"}
                      {task.isOverdue ? " · Overdue" : null}
                      {task.isDueToday && !task.isOverdue ? " · Due today" : null}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
