import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { ActivityListTable } from "@/components/crm/activity-list-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import {
  ACTIVITY_LIST_DATE_OPTIONS,
  ACTIVITY_LIST_GROUP_OPTIONS,
  ACTIVITY_LIST_RECORD_OPTIONS,
  ACTIVITY_LIST_SORT_OPTIONS,
  buildActivityListHref,
  fetchActivityList,
  formatActivityCountLabel,
  formatActivityListDateLabel,
  formatActivityListGroupLabel,
  formatActivityListRecordLabel,
  formatActivityListSortLabel,
  hasActiveActivityListFilters,
  parseActivityListFilters,
  SYSTEM_USER_VALUE,
  type ActivityListSearchParams,
} from "@/lib/crm/activity-list";
import { loadCrmStaffProfiles } from "@/lib/crm/crm-staff";
import { formatRoleLabel } from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminActivityPageProps = {
  searchParams: Promise<ActivityListSearchParams>;
};

export default async function AdminActivityPage({
  searchParams,
}: AdminActivityPageProps) {
  const rawSearchParams = await searchParams;
  const filters = parseActivityListFilters(rawSearchParams);
  const hasFilters = hasActiveActivityListFilters(filters);

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/activity");
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? "";

  const [
    { items, totalCount, hasMore, queryError },
    { data: activeCompanies },
    crmStaff,
  ] = await Promise.all([
    fetchActivityList(supabase, filters),
    supabase
      .from("companies")
      .select("id, company_name")
      .eq("is_active", true)
      .order("company_name"),
    loadCrmStaffProfiles(supabase),
  ]);

  const loadMoreHref = hasMore
    ? buildActivityListHref(filters, { page: filters.page + 1 })
    : null;

  const quickFilters = [
    {
      label: "My activity",
      href: buildActivityListHref(
        { ...filters, page: 1 },
        { userId: currentUserId, systemOnly: false, page: 1 }
      ),
    },
    {
      label: "Today",
      href: buildActivityListHref(
        { ...filters, page: 1 },
        { date: "today", page: 1 }
      ),
    },
    {
      label: "Notes",
      href: buildActivityListHref(
        { ...filters, page: 1 },
        { group: "notes", page: 1 }
      ),
    },
    {
      label: "Quotes",
      href: buildActivityListHref(
        { ...filters, page: 1 },
        { group: "quotes", page: 1 }
      ),
    },
    {
      label: "Tasks",
      href: buildActivityListHref(
        { ...filters, page: 1 },
        { group: "tasks", page: 1 }
      ),
    },
    {
      label: "Portal invites",
      href: buildActivityListHref(
        { ...filters, page: 1 },
        { group: "portal", page: 1 }
      ),
    },
  ];

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title="Activity"
          description="Review CRM activity across companies, contacts, opportunities, quotes and tasks."
        />

        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          {formatActivityCountLabel(totalCount)}
        </p>

        <div className="mb-6 flex flex-wrap gap-2">
          {quickFilters.map((filter) => (
            <Link key={filter.label} href={filter.href}>
              <Button variant="outline" size="sm">
                {filter.label}
              </Button>
            </Link>
          ))}
        </div>

        <Card className="portal-surface mb-6">
          <CardContent className="pt-6">
            <form
              method="get"
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            >
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="search">Search</Label>
                <Input
                  id="search"
                  name="search"
                  type="search"
                  placeholder="Search activity…"
                  defaultValue={filters.search}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="user">User</Label>
                <Select
                  id="user"
                  name="user"
                  defaultValue={
                    filters.systemOnly
                      ? SYSTEM_USER_VALUE
                      : filters.userId ?? ""
                  }
                >
                  <option value="">All users</option>
                  <option value={SYSTEM_USER_VALUE}>System activity</option>
                  {crmStaff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name?.trim() || "Unnamed staff member"}
                      {" · "}
                      {formatRoleLabel(member.user_role)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="group">Activity type</Label>
                <Select
                  id="group"
                  name="group"
                  defaultValue={filters.group}
                >
                  {ACTIVITY_LIST_GROUP_OPTIONS.map((group) => (
                    <option key={group} value={group}>
                      {formatActivityListGroupLabel(group)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="record">Record type</Label>
                <Select
                  id="record"
                  name="record"
                  defaultValue={filters.record}
                >
                  <option value="all">All records</option>
                  {ACTIVITY_LIST_RECORD_OPTIONS.filter(
                    (record) => record !== "all"
                  ).map((record) => (
                    <option key={record} value={record}>
                      {formatActivityListRecordLabel(record)}
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
                <Label htmlFor="date">Date</Label>
                <Select id="date" name="date" defaultValue={filters.date}>
                  {ACTIVITY_LIST_DATE_OPTIONS.map((date) => (
                    <option key={date} value={date}>
                      {formatActivityListDateLabel(date)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="from">From date</Label>
                <Input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={filters.fromDate ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="to">To date</Label>
                <Input
                  id="to"
                  name="to"
                  type="date"
                  defaultValue={filters.toDate ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sort">Sort</Label>
                <Select id="sort" name="sort" defaultValue={filters.sort}>
                  {ACTIVITY_LIST_SORT_OPTIONS.map((sort) => (
                    <option key={sort} value={sort}>
                      {formatActivityListSortLabel(sort)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
                <Button type="submit">Apply filters</Button>
                {hasFilters ? (
                  <Link href="/admin/activity">
                    <Button type="button" variant="outline">
                      Clear filters
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
              Unable to load activity: {queryError}
            </CardContent>
          </Card>
        ) : null}

        {items.length === 0 && !queryError ? (
          <Card className="portal-surface">
            <CardContent className="py-12">
              <EmptyState
                title={
                  hasFilters
                    ? "No activity matches your filters."
                    : "No CRM activity yet."
                }
                description={
                  hasFilters
                    ? "Try adjusting your search or filters."
                    : "Activity from companies, contacts, opportunities, quotes and tasks will appear here."
                }
                action={
                  hasFilters ? (
                    <Link href="/admin/activity">
                      <Button variant="outline" size="sm">
                        Clear filters
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            </CardContent>
          </Card>
        ) : null}

        {items.length > 0 ? (
          <Card className="portal-surface overflow-hidden">
            <ActivityListTable
              items={items}
              hasMore={hasMore}
              loadMoreHref={loadMoreHref}
            />
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
