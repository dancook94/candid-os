import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { NoteComposer } from "@/components/crm/note-composer";
import { NotesList } from "@/components/crm/notes-list";
import { CreateQuoteButton } from "@/components/crm/create-quote-button";
import { OpportunityAssignmentEditor } from "@/components/crm/opportunity-assignment-editor";
import { OpportunityContactEditor } from "@/components/crm/opportunity-contact-editor";
import { OpportunityQuickActions } from "@/components/crm/opportunity-quick-actions";
import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { OpportunityStageChange } from "@/components/crm/opportunity-stage-change";
import { StaffAvatarStack } from "@/components/crm/staff-avatar-stack";
import { TaskAssigneeDisplay } from "@/components/crm/task-assignee-display";
import { TaskPriorityBadge, TaskStatusBadge } from "@/components/crm/task-badges";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { getCrmNotes, getCrmTimeline } from "@/lib/crm/get-crm-timeline";
import { getStaffDisplayName, loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import {
  formatCrmDate,
  formatCrmDateTime,
} from "@/lib/crm/format-datetime";
import { loadOpportunityCollaboratorIds, loadOpportunityDetail } from "@/lib/crm/opportunity-detail";
import { formatOpportunitySourceLabel } from "@/lib/crm/source-labels";
import { getActiveQuotesForOpportunity } from "@/lib/crm/opportunity-linking";
import { loadQuoteContactDisplay } from "@/lib/crm/quote-contact-display";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";
import { formatGbp } from "@/lib/format-currency";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OpportunityDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function OpportunityDetailPage({
  params,
}: OpportunityDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    `/admin/opportunities/${id}`
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id;

  if (!currentUserId) {
    notFound();
  }

  const detail = await loadOpportunityDetail(supabase, id);

  if (!detail) {
    notFound();
  }

  const isAdmin = ["super_admin", "admin"].includes(profile.user_role);
  const crmScope = {
    type: "opportunity" as const,
    opportunityId: id,
    companyId: detail.opportunity.company_id,
    contactId: detail.opportunity.contact_id,
  };
  const [notes, { items: activity }] = await Promise.all([
    getCrmNotes(supabase, {
      scope: crmScope,
      currentUserId,
      isAdmin,
    }),
    getCrmTimeline(supabase, {
      scope: crmScope,
      limit: 50,
    }),
  ]);

  const [activeQuotes, crmStaff, collaboratorIds, contact, { data: companies }] =
    await Promise.all([
    getActiveQuotesForOpportunity(supabase, id),
    loadCrmStaffProfiles(supabase),
    loadOpportunityCollaboratorIds(supabase, id),
    loadQuoteContactDisplay(supabase, detail.opportunity.contact_id),
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
  ]);

  const { opportunity } = detail;
  const openTasks = detail.tasks.filter((task) =>
    OPEN_TASK_STATUSES.includes(task.status)
  );
  const overdueTasks = openTasks.filter(
    (task) => task.due_at && new Date(task.due_at).getTime() < Date.now()
  );
  const nextTask = openTasks[0] ?? null;
  const primaryQuote = detail.quotes[0] ?? null;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title={opportunity.title}
          description={detail.company_name}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/opportunities/${id}/edit`}>
                <Button variant="outline">Edit opportunity</Button>
              </Link>
              <CreateQuoteButton
                opportunityId={id}
                hasContact={Boolean(detail.opportunity.contact_id)}
                activeQuotes={activeQuotes}
              />
              <Link
                href={`/admin/tasks/new?opportunityId=${encodeURIComponent(id)}`}
              >
                <Button variant="outline">Add task</Button>
              </Link>
              <OpportunityQuickActions
                opportunityId={id}
                currentStage={opportunity.stage}
              />
            </div>
          }
        />

        {primaryQuote ? (
          <Card className="portal-surface mb-6">
            <CardHeader>
              <CardTitle>Linked quote summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Quote
                </p>
                <Link
                  href={`/admin/quotes/${primaryQuote.id}`}
                  className="mt-1 block font-medium hover:underline"
                >
                  Q-{primaryQuote.quote_number} · {primaryQuote.project_name}
                </Link>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <p className="mt-1 font-medium capitalize">{primaryQuote.status}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current value
                </p>
                <p className="mt-1 font-medium">
                  {primaryQuote.current_version_total !== null
                    ? formatGbp(primaryQuote.current_version_total)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Next task
                </p>
                <p className="mt-1 font-medium">
                  {nextTask ? nextTask.title : "None scheduled"}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {overdueTasks.length > 0 ? (
          <Card className="portal-surface mb-6 border-amber-400/50">
            <CardHeader>
              <CardTitle>Overdue tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {overdueTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/admin/tasks/${task.id}/edit`}
                  className="block rounded-lg border border-border px-4 py-3 hover:bg-muted/30"
                >
                  <p className="font-medium">{task.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Due {formatCrmDateTime(task.due_at)}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {!detail.opportunity.contact_id ? (
          <Card className="portal-surface mb-6 border-amber-400/50 bg-amber-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-amber-800">
                No contact linked
              </p>
              <p className="mt-1 text-sm text-amber-700">
                Add a contact to this opportunity before creating a linked quote.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Stage
                </p>
                <div className="mt-1">
                  <OpportunityStageBadge stage={opportunity.stage} />
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Estimated value
                </p>
                <p className="mt-1 font-medium">
                  {opportunity.estimated_value !== null
                    ? formatGbp(Number(opportunity.estimated_value))
                    : "—"}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current quote value
                </p>
                <p className="mt-1 font-medium">
                  {detail.current_quote_value !== null
                    ? formatGbp(detail.current_quote_value)
                    : "—"}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Source
                </p>
                <p className="mt-1 font-medium">
                  {formatOpportunitySourceLabel(opportunity.source)}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Owner
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <StaffAvatarDisplay
                    fullName={getStaffDisplayName(detail.owner)}
                    size="sm"
                  />
                  <span>{getStaffDisplayName(detail.owner)}</span>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Collaborators
                </p>
                <div className="mt-1">
                  <StaffAvatarStack members={detail.collaborators} size="sm" />
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Expected close
                </p>
                <p className="mt-1 font-medium">
                  {formatCrmDate(opportunity.expected_close_date)}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Next follow-up
                </p>
                <p className="mt-1 font-medium">
                  {formatCrmDateTime(opportunity.next_follow_up_at)}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="mt-1 font-medium">
                  {formatCrmDateTime(opportunity.created_at)}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Updated
                </p>
                <p className="mt-1 font-medium">
                  {formatCrmDateTime(opportunity.updated_at)}
                </p>
              </div>

              {opportunity.description ? (
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {opportunity.description}
                  </p>
                </div>
              ) : null}

              {opportunity.stage === "lost" && opportunity.lost_reason ? (
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Lost reason
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {opportunity.lost_reason}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Change stage</CardTitle>
            </CardHeader>
            <CardContent>
              <OpportunityStageChange
                opportunityId={id}
                currentStage={opportunity.stage}
              />
            </CardContent>
          </Card>

          <OpportunityContactEditor
            opportunityId={id}
            companyId={opportunity.company_id}
            companies={companies ?? []}
            contact={contact}
          />

          <OpportunityAssignmentEditor
            opportunityId={id}
            crmStaff={crmStaff}
            ownerId={opportunity.owner_profile_id}
            collaboratorIds={collaboratorIds}
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <Card className="portal-surface">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Tasks</CardTitle>
              <Link
                href={`/admin/tasks/new?opportunityId=${encodeURIComponent(id)}`}
              >
                <Button size="sm" variant="outline">
                  Add task
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {detail.tasks.length === 0 ? (
                <EmptyState
                  title="No tasks yet"
                  description="Add follow-up tasks for this opportunity."
                />
              ) : (
                <div className="space-y-3">
                  {detail.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-xl border border-border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <Link
                            href={`/admin/tasks/${task.id}/edit`}
                            className="font-medium hover:underline"
                          >
                            {task.title}
                          </Link>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Due {formatCrmDateTime(task.due_at)}
                          </p>
                          <div className="mt-2">
                            <TaskAssigneeDisplay assignees={task.assignees} />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <TaskStatusBadge status={task.status} />
                          <TaskPriorityBadge priority={task.priority} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <NoteComposer
                context={{
                  companyId: opportunity.company_id,
                  contactId: opportunity.contact_id,
                  opportunityId: id,
                }}
              />
              <NotesList notes={notes} />
            </CardContent>
          </Card>

          <Card className="portal-surface xl:col-span-2">
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                items={activity}
                showFilters={false}
                compact
              />
            </CardContent>
          </Card>

          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Linked quote requests</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.quoteRequests.length === 0 ? (
                <EmptyState
                  title="No linked quote requests"
                  description="Quote requests linked to this opportunity will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {detail.quoteRequests.map((request) => (
                    <Link
                      key={request.id}
                      href={`/admin/quote-requests/${request.id}`}
                      className="block rounded-xl border border-border p-4 transition-colors hover:bg-muted/30"
                    >
                      <p className="font-medium">{request.project_name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {request.status} · {formatCrmDate(request.created_at)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="portal-surface">
            <CardHeader>
              <CardTitle>Linked quotes</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.quotes.length === 0 ? (
                <EmptyState
                  title="No linked quotes"
                  description="Quotes linked to this opportunity will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {detail.quotes.map((quote) => (
                    <Link
                      key={quote.id}
                      href={`/admin/quotes/${quote.id}`}
                      className="block rounded-xl border border-border p-4 transition-colors hover:bg-muted/30"
                    >
                      <p className="font-medium">
                        Q-{quote.quote_number} · {quote.project_name}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {quote.status}
                        {quote.current_version_total !== null
                          ? ` · ${formatGbp(quote.current_version_total)}`
                          : ""}
                        {" · "}
                        {formatCrmDate(quote.updated_at)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
