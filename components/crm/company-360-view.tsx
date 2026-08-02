"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CompanyLogoDisplay } from "@/components/company-logo-display";
import { CompanyLogoForm } from "@/components/company-logo-form";
import { CompanyPaymentTermsForm } from "@/components/company-payment-terms-form";
import { EmptyState } from "@/components/empty-state";
import { ContactsTable } from "@/components/crm/contacts-table";
import { NewContactButton } from "@/components/crm/contact-form-dialog";
import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { StaffAvatarStack } from "@/components/crm/staff-avatar-stack";
import { TaskAssigneeDisplay } from "@/components/crm/task-assignee-display";
import { TaskPriorityBadge, TaskStatusBadge } from "@/components/crm/task-badges";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatAdminQuoteStatusLabel } from "@/lib/admin-quote-status";
import { formatActivityTypeLabel } from "@/lib/crm/activity-types";
import type {
  Company360ActivityCategory,
  Company360ActivityItem,
  Company360Data,
} from "@/lib/crm/company-360";
import { formatCrmDate, formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { OpportunityListRow } from "@/lib/crm/opportunities-list";
import { formatGbp } from "@/lib/format-currency";
import { formatPaymentTermsLabel } from "@/lib/payment-terms";
import { cn } from "@/lib/utils";

type Company360Tab =
  | "overview"
  | "opportunities"
  | "quotes"
  | "tasks"
  | "contacts"
  | "activity";

type Company360Company = {
  id: string;
  company_name: string;
  trading_name: string | null;
  accounts_email: string | null;
  phone: string | null;
  vat_number: string | null;
  payment_terms_days: number | null;
  is_active: boolean;
  created_at: string;
  logoPreviewUrl: string | null;
  logo: {
    logo_storage_path: string | null;
    logo_file_name: string | null;
    logo_file_type: string | null;
    logo_file_size: number | null;
  };
};

type Company360ViewProps = {
  company: Company360Company;
  data: Company360Data;
};

const tabs: { id: Company360Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "opportunities", label: "Opportunities" },
  { id: "quotes", label: "Quotes" },
  { id: "tasks", label: "Tasks" },
  { id: "contacts", label: "Contacts" },
  { id: "activity", label: "Activity" },
];

const activityFilters: {
  id: Company360ActivityCategory | "all";
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "opportunities", label: "Opportunities" },
  { id: "quotes", label: "Quotes" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
];

function formatStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapQuoteStatusToBadge(
  status: string
): "approved" | "pending" | "disabled" | "sent" | "draft" {
  switch (status.toLowerCase()) {
    case "sent":
      return "sent";
    case "accepted":
      return "approved";
    case "declined":
    case "expired":
      return "disabled";
    default:
      return "draft";
  }
}

function Company360SummaryCards({
  companyId,
  summary,
}: {
  companyId: string;
  summary: Company360Data["summary"];
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Active opportunities"
        value={summary.activeOpportunitiesCount}
        description="Open sales opportunities"
        href={`/admin/opportunities?company=${companyId}&scope=active`}
      />
      <StatCard
        label="Active pipeline value"
        value={formatGbp(summary.activePipelineValue)}
        description="Estimated open opportunity value"
        href={`/admin/opportunities?company=${companyId}&scope=active`}
      />
      <StatCard
        label="Quotes sent value"
        value={summary.quotesSent.formattedValue}
        meta={summary.quotesSent.formattedQuoteCount}
        href={`/admin/quotes?company=${companyId}&status=sent`}
      />
      <StatCard
        label="Quotes accepted value"
        value={summary.quotesAccepted.formattedValue}
        meta={summary.quotesAccepted.formattedQuoteCount}
        href={`/admin/quotes?company=${companyId}&status=accepted`}
      />
      <StatCard
        label="Quotes declined value"
        value={summary.quotesDeclined.formattedValue}
        meta={summary.quotesDeclined.formattedQuoteCount}
        href={`/admin/quotes?company=${companyId}&status=declined`}
        accentClassName="bg-red-400/45"
      />
      <StatCard
        label="Open tasks"
        value={summary.openTasksCount}
        description="Incomplete tasks linked to this account"
        href={`/admin/tasks?company=${companyId}`}
      />
      <StatCard
        label="Overdue tasks"
        value={summary.overdueTasksCount}
        description="Past due and incomplete"
        href={`/admin/tasks?company=${companyId}&view=overdue`}
        accentClassName="bg-red-400/45"
      />
    </div>
  );
}

function OpportunitiesTable({
  companyId,
  opportunities,
}: {
  companyId: string;
  opportunities: OpportunityListRow[];
}) {
  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
        <div>
          <CardTitle className="text-lg font-semibold">Opportunities</CardTitle>
          <CardDescription>
            Active and recently updated sales opportunities.
          </CardDescription>
        </div>
        <Link
          href={`/admin/opportunities?company=${companyId}`}
          className="shrink-0 text-sm font-medium text-foreground hover:underline"
        >
          View all opportunities
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {opportunities.length === 0 ? (
          <EmptyState
            title="No active opportunities"
            description="Create an opportunity to start tracking this account's pipeline."
            action={
              <Link href="/admin/opportunities/new">
                <Button size="sm">New opportunity</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Stage</th>
                  <th>Estimated value</th>
                  <th>Current quote value</th>
                  <th>Owner</th>
                  <th>Collaborators</th>
                  <th>Next follow-up</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/opportunities/${opportunity.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {opportunity.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <OpportunityStageBadge stage={opportunity.stage} />
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {opportunity.estimated_value !== null
                        ? formatGbp(opportunity.estimated_value)
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {opportunity.current_quote_value !== null
                        ? formatGbp(opportunity.current_quote_value)
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {opportunity.owner_name}
                    </td>
                    <td className="px-4 py-3.5">
                      <StaffAvatarStack
                        members={opportunity.collaborators}
                        maxVisible={3}
                      />
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatCrmDateTime(opportunity.next_follow_up_at)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatCrmDate(opportunity.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuotesTable({
  companyId,
  quotes,
}: {
  companyId: string;
  quotes: Company360Data["quotes"];
}) {
  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
        <div>
          <CardTitle className="text-lg font-semibold">Quotes</CardTitle>
          <CardDescription>
            Quotes linked to this company (current versions only).
          </CardDescription>
        </div>
        <Link
          href={`/admin/quotes?company=${companyId}`}
          className="shrink-0 text-sm font-medium text-foreground hover:underline"
        >
          View all quotes
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {quotes.length === 0 ? (
          <EmptyState
            title="No quotes yet"
            description="Create a quote for this company to track proposals here."
            action={
              <Link href="/admin/quotes/new">
                <Button size="sm">New quote</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Quote number</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Current version</th>
                  <th>Total</th>
                  <th>Linked opportunity</th>
                  <th>Sent date</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/quotes/${quote.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        Q-{quote.quote_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {quote.project_name}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        status={mapQuoteStatusToBadge(quote.status)}
                        label={formatAdminQuoteStatusLabel(quote.status)}
                      />
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      v{quote.current_version}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatGbp(quote.current_version_total)}
                    </td>
                    <td className="px-4 py-3.5">
                      {quote.opportunity_id ? (
                        <Link
                          href={`/admin/opportunities/${quote.opportunity_id}`}
                          className="text-foreground hover:underline"
                        >
                          {quote.opportunity_title ?? "Linked opportunity"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatCrmDate(quote.sent_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TasksTable({
  companyId,
  tasks,
}: {
  companyId: string;
  tasks: Company360Data["tasks"];
}) {
  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
        <div>
          <CardTitle className="text-lg font-semibold">Tasks</CardTitle>
          <CardDescription>
            Incomplete tasks linked to this company, its opportunities, and
            quotes.
          </CardDescription>
        </div>
        <Link
          href={`/admin/tasks?company=${companyId}`}
          className="shrink-0 text-sm font-medium text-foreground hover:underline"
        >
          View all tasks
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {tasks.length === 0 ? (
          <EmptyState
            title="No open tasks"
            description="Tasks for this account will appear here when created."
            action={
              <Link href="/admin/tasks/new">
                <Button size="sm">New task</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Assignees</th>
                  <th>Due date</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Linked opportunity</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/tasks/${task.id}`}
                        className={cn(
                          "font-medium hover:underline",
                          task.isOverdue
                            ? "text-red-700"
                            : "text-foreground"
                        )}
                      >
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <TaskAssigneeDisplay
                        assignees={task.assignees}
                        showNames={false}
                      />
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3.5",
                        task.isOverdue
                          ? "font-medium text-red-700"
                          : "text-muted-foreground"
                      )}
                    >
                      {formatCrmDateTime(task.due_at)}
                    </td>
                    <td className="px-4 py-3.5">
                      <TaskPriorityBadge priority={task.priority} />
                    </td>
                    <td className="px-4 py-3.5">
                      <TaskStatusBadge status={task.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      {task.opportunity_id ? (
                        <Link
                          href={`/admin/opportunities/${task.opportunity_id}`}
                          className="text-foreground hover:underline"
                        >
                          {task.opportunity_title ?? "Linked opportunity"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompanyContactsSection({
  contacts,
  companyId,
  companyName,
}: {
  contacts: Company360Data["contacts"];
  companyId: string;
  companyName: string;
}) {
  const companyOptions = [{ id: companyId, company_name: companyName }];

  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
        <div>
          <CardTitle className="text-lg font-semibold">Contacts</CardTitle>
          <CardDescription>
            CRM contacts at {companyName}. Portal access is optional.
          </CardDescription>
        </div>
        <NewContactButton
          companies={companyOptions}
          defaultCompanyId={companyId}
          lockCompany
          label="Add contact"
          variant="outline"
          size="sm"
        />
      </CardHeader>
      <CardContent className="p-0">
        {contacts.length === 0 ? (
          <EmptyState
            title="No contacts yet"
            description="Add a contact to record people at this company before inviting them to the portal."
            action={
              <NewContactButton
                companies={companyOptions}
                defaultCompanyId={companyId}
                lockCompany
                label="Add contact"
              />
            }
          />
        ) : (
          <ContactsTable
            contacts={contacts}
            companies={companyOptions}
            showCompanyColumn={false}
            showQuickActions
          />
        )}
      </CardContent>
    </Card>
  );
}

function ActivityTimeline({ activity }: { activity: Company360ActivityItem[] }) {
  const [filter, setFilter] = useState<
    Company360ActivityCategory | "all"
  >("all");

  const filteredActivity = useMemo(() => {
    if (filter === "all") {
      return activity;
    }

    return activity.filter((item) => item.category === filter);
  }, [activity, filter]);

  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Activity timeline</CardTitle>
        <CardDescription>
          Combined activity from opportunities, quotes, tasks, and notes stored
          for this account.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {activityFilters.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                filter === option.id
                  ? "bg-muted text-foreground ring-1 ring-border"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredActivity.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">
            No activity recorded for this filter yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredActivity.map((item) => (
              <div key={item.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {item.source === "note"
                        ? "Note"
                        : formatActivityTypeLabel(item.activity_type)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm text-muted-foreground">
                    {formatCrmDateTime(item.created_at)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {item.author_name ? <span>{item.author_name}</span> : null}
                  {item.opportunity_id ? (
                    <Link
                      href={`/admin/opportunities/${item.opportunity_id}`}
                      className="text-foreground hover:underline"
                    >
                      {item.opportunity_title ?? "Opportunity"}
                    </Link>
                  ) : null}
                  {item.quote_id ? (
                    <Link
                      href={`/admin/quotes/${item.quote_id}`}
                      className="text-foreground hover:underline"
                    >
                      {item.quote_label ?? "Quote"}
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompanyDetailsSection({ company }: { company: Company360Company }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <Card className="portal-surface overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">Company details</CardTitle>
          <CardDescription>
            Registered on {formatCrmDate(company.created_at)}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <dl className="grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="portal-field-label">Legal name</dt>
              <dd className="portal-detail-value">{company.company_name}</dd>
            </div>
            <div>
              <dt className="portal-field-label">Trading name</dt>
              <dd className="portal-detail-value">
                {company.trading_name || "—"}
              </dd>
            </div>
            <div>
              <dt className="portal-field-label">Accounts email</dt>
              <dd className="portal-detail-value">
                {company.accounts_email || "—"}
              </dd>
            </div>
            <div>
              <dt className="portal-field-label">Phone</dt>
              <dd className="portal-detail-value">{company.phone || "—"}</dd>
            </div>
            <div>
              <dt className="portal-field-label">VAT number</dt>
              <dd className="portal-detail-value">
                {company.vat_number || "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="portal-surface overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">
            Commercial settings
          </CardTitle>
          <CardDescription>
            Default payment terms for new quotes created for this company.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <CompanyPaymentTermsForm
            companyId={company.id}
            initialPaymentTermsDays={company.payment_terms_days}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function Company360View({ company, data }: Company360ViewProps) {
  const [activeTab, setActiveTab] = useState<Company360Tab>("overview");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 border-b border-border pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <CompanyLogoDisplay
            companyName={company.company_name}
            logoUrl={company.logoPreviewUrl}
            size="lg"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {company.company_name}
              </h1>
              <StatusBadge
                status={company.is_active ? "approved" : "disabled"}
                label={company.is_active ? "Active" : "Inactive"}
              />
            </div>
            {company.trading_name ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Trading as {company.trading_name}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span>
                Payment terms:{" "}
                <span className="font-medium text-foreground">
                  {formatPaymentTermsLabel(company.payment_terms_days)}
                </span>
              </span>
              <span>
                Contacts:{" "}
                <span className="font-medium text-foreground">
                  {data.contacts.length}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
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
          <Link href="/admin/quotes/new">
            <Button variant="outline" size="sm">
              New quote
            </Button>
          </Link>
          <Link href="/admin/companies">
            <Button variant="outline" size="sm">
              Back to companies
            </Button>
          </Link>
        </div>
      </div>

      {data.errors.length > 0 ? (
        <Card className="portal-surface border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-amber-900">
              Some CRM data could not be loaded
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {data.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-muted text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-6">
          <Company360SummaryCards
            companyId={company.id}
            summary={data.summary}
          />
          <OpportunitiesTable
            companyId={company.id}
            opportunities={data.opportunities.slice(0, 5)}
          />
          <QuotesTable companyId={company.id} quotes={data.quotes.slice(0, 5)} />
          <TasksTable companyId={company.id} tasks={data.tasks.slice(0, 5)} />
          <CompanyDetailsSection company={company} />
          <Card className="portal-surface overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg font-semibold">
                Portal branding
              </CardTitle>
              <CardDescription>
                This logo appears in the customer&apos;s portal. Candid branding
                remains on quotations and emails.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <CompanyLogoForm
                companyId={company.id}
                companyName={company.company_name}
                initialLogo={company.logo}
                initialPreviewUrl={company.logoPreviewUrl}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "opportunities" ? (
        <OpportunitiesTable
          companyId={company.id}
          opportunities={data.opportunities}
        />
      ) : null}

      {activeTab === "quotes" ? (
        <QuotesTable companyId={company.id} quotes={data.quotes} />
      ) : null}

      {activeTab === "tasks" ? (
        <TasksTable companyId={company.id} tasks={data.tasks} />
      ) : null}

      {activeTab === "contacts" ? (
        <CompanyContactsSection
          contacts={data.contacts}
          companyId={company.id}
          companyName={company.company_name}
        />
      ) : null}

      {activeTab === "activity" ? (
        <ActivityTimeline activity={data.activity} />
      ) : null}
    </div>
  );
}
