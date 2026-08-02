import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { ClickableTableRow } from "@/components/crm/clickable-table-row";
import { CrmViewToggle } from "@/components/crm/crm-view-toggle";
import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { StaffAvatarStack } from "@/components/crm/staff-avatar-stack";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import {
  buildOpportunitiesListHref,
  fetchOpportunitiesList,
  formatOpportunitySortLabel,
  hasActiveOpportunitiesListFilters,
  OPPORTUNITY_LIST_SCOPE_OPTIONS,
  OPPORTUNITY_LIST_SORT_OPTIONS,
  parseOpportunitiesListFilters,
  type OpportunitiesListSearchParams,
} from "@/lib/crm/opportunities-list";
import { getOpportunityStageOptions } from "@/lib/crm/opportunity-stages";
import {
  formatCrmDate,
  formatCrmDateTime,
} from "@/lib/crm/format-datetime";
import { formatGbp } from "@/lib/format-currency";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminOpportunitiesPageProps = {
  searchParams: Promise<OpportunitiesListSearchParams>;
};

function formatScopeLabel(scope: (typeof OPPORTUNITY_LIST_SCOPE_OPTIONS)[number]) {
  switch (scope) {
    case "all":
      return "All";
    case "active":
      return "Active";
    case "won":
      return "Won";
    case "lost":
      return "Lost";
    default:
      return scope;
  }
}

export default async function AdminOpportunitiesPage({
  searchParams,
}: AdminOpportunitiesPageProps) {
  const rawSearchParams = await searchParams;
  const filters = parseOpportunitiesListFilters(rawSearchParams);
  const hasFilters = hasActiveOpportunitiesListFilters(filters);

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/opportunities");
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const [
    { opportunities, totalCount, queryError },
    { data: activeCompanies },
    crmStaff,
  ] = await Promise.all([
    fetchOpportunitiesList(supabase, filters),
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
    loadCrmStaffProfiles(supabase),
  ]);

  const listHref = buildOpportunitiesListHref(filters, { view: "list" });
  const pipelineHref = buildOpportunitiesListHref(filters, {
    view: "pipeline",
  });

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title="Opportunities"
          description="Manage enquiries and your sales pipeline."
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <CrmViewToggle
                listHref={listHref}
                pipelineHref={pipelineHref}
                activeView={filters.view}
              />
              <Link href="/admin/opportunities/new">
                <Button>New opportunity</Button>
              </Link>
            </div>
          }
        />

        {filters.view === "pipeline" ? (
          <Card className="portal-surface">
            <CardContent className="py-12">
              <EmptyState
                title="Pipeline view coming next"
                description="The kanban pipeline board will be added in the next CRM phase. Switch to List view to browse and manage opportunities now."
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="portal-surface mb-6">
              <CardContent className="pt-6">
                <form
                  method="get"
                  className="grid gap-4 md:grid-cols-2 xl:grid-cols-6"
                >
                  <input type="hidden" name="view" value="list" />

                  <div className="space-y-2 md:col-span-2 xl:col-span-2">
                    <Label htmlFor="search">Search</Label>
                    <Input
                      id="search"
                      name="search"
                      type="search"
                      placeholder="Title, company or description…"
                      defaultValue={filters.search}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stage">Stage</Label>
                    <Select
                      id="stage"
                      name="stage"
                      defaultValue={filters.stage ?? ""}
                    >
                      <option value="">All stages</option>
                      {getOpportunityStageOptions().map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="owner">Owner</Label>
                    <Select
                      id="owner"
                      name="owner"
                      defaultValue={filters.ownerId ?? ""}
                    >
                      <option value="">All owners</option>
                      {crmStaff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name?.trim() || "Unnamed staff member"}
                        </option>
                      ))}
                    </Select>
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
                    <Label htmlFor="scope">Scope</Label>
                    <Select
                      id="scope"
                      name="scope"
                      defaultValue={filters.scope}
                    >
                      {OPPORTUNITY_LIST_SCOPE_OPTIONS.map((scope) => (
                        <option key={scope} value={scope}>
                          {formatScopeLabel(scope)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sort">Sort</Label>
                    <Select id="sort" name="sort" defaultValue={filters.sort}>
                      {OPPORTUNITY_LIST_SORT_OPTIONS.map((sort) => (
                        <option key={sort} value={sort}>
                          {formatOpportunitySortLabel(sort)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex items-end gap-2 md:col-span-2 xl:col-span-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="follow_up"
                        value="overdue"
                        defaultChecked={filters.overdueFollowUp}
                        className="rounded border-input"
                      />
                      Overdue follow-up only
                    </label>
                    <Button type="submit">Apply filters</Button>
                    {hasFilters ? (
                      <Link href="/admin/opportunities?view=list">
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
                  Unable to load opportunities: {queryError}
                </CardContent>
              </Card>
            ) : null}

            {opportunities.length === 0 ? (
              <Card className="portal-surface">
                <CardContent className="py-12">
                  <EmptyState
                    title="No opportunities found"
                    description={
                      hasFilters
                        ? "Try adjusting your search or filters."
                        : "Create your first opportunity to start tracking the sales pipeline."
                    }
                    action={
                      hasFilters ? undefined : (
                        <Link href="/admin/opportunities/new">
                          <Button>New opportunity</Button>
                        </Link>
                      )
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="portal-surface overflow-hidden">
                <div className="border-b border-border px-6 py-4 text-sm text-muted-foreground">
                  {totalCount === 1
                    ? "1 opportunity"
                    : `${totalCount} opportunities`}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-6 py-3 font-medium">Opportunity</th>
                        <th className="px-6 py-3 font-medium">Company</th>
                        <th className="px-6 py-3 font-medium">Stage</th>
                        <th className="px-6 py-3 font-medium">Estimated</th>
                        <th className="px-6 py-3 font-medium">Quote value</th>
                        <th className="px-6 py-3 font-medium">Owner</th>
                        <th className="px-6 py-3 font-medium">Collaborators</th>
                        <th className="px-6 py-3 font-medium">Next follow-up</th>
                        <th className="px-6 py-3 font-medium">Updated</th>
                        <th className="px-6 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opportunities.map((opportunity) => (
                        <ClickableTableRow
                          key={opportunity.id}
                          href={`/admin/opportunities/${opportunity.id}`}
                        >
                          <td className="px-6 py-4 font-medium">
                            {opportunity.title}
                          </td>
                          <td className="px-6 py-4">{opportunity.company_name}</td>
                          <td className="px-6 py-4">
                            <OpportunityStageBadge stage={opportunity.stage} />
                          </td>
                          <td className="px-6 py-4">
                            {opportunity.estimated_value !== null
                              ? formatGbp(opportunity.estimated_value)
                              : "—"}
                          </td>
                          <td className="px-6 py-4">
                            {opportunity.current_quote_value !== null
                              ? formatGbp(opportunity.current_quote_value)
                              : "—"}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <StaffAvatarDisplay
                                fullName={opportunity.owner_name}
                                size="sm"
                              />
                              <span>{opportunity.owner_name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <StaffAvatarStack
                              members={opportunity.collaborators}
                              maxVisible={3}
                              size="sm"
                            />
                          </td>
                          <td className="px-6 py-4">
                            {formatCrmDateTime(opportunity.next_follow_up_at)}
                          </td>
                          <td className="px-6 py-4">
                            {formatCrmDate(opportunity.updated_at)}
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-medium">View</span>
                          </td>
                        </ClickableTableRow>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
