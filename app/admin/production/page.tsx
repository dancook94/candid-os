import Link from "next/link";
import { Factory } from "lucide-react";

import { ProductionBoard } from "@/components/production/production-board";
import { AppShell } from "@/components/app-shell";
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
  buildProductionBoardHref,
  hasActiveProductionBoardFilters,
  parseProductionBoardFilters,
  type ProductionBoardSearchParams,
} from "@/lib/production/board";
import {
  PRODUCTION_PRIORITIES,
  PRODUCTION_PRIORITY_LABELS,
} from "@/lib/production/constants";
import { fetchProductionBoard } from "@/lib/production/service";
import {
  loadProductionFilterOptions,
  loadProductionStaffProfiles,
} from "@/lib/production/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminProductionPageProps = {
  searchParams: Promise<ProductionBoardSearchParams>;
};

export default async function AdminProductionPage({
  searchParams,
}: AdminProductionPageProps) {
  const rawSearchParams = await searchParams;
  const filters = parseProductionBoardFilters(rawSearchParams);
  const hasFilters = hasActiveProductionBoardFilters(filters);

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/production");
  const shellProps = await buildCrmAppShellProps(supabase, profile);
  const adminClient = createAdminClient();

  const [boardResult, { data: activeCompanies }, staff, filterOptions] =
    await Promise.all([
      fetchProductionBoard(adminClient, filters),
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
      loadProductionStaffProfiles(supabase),
      loadProductionFilterOptions(adminClient),
    ]);

  const clearHref = "/admin/production";

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-[100rem]">
        <PageHeader
          eyebrow="Production"
          title="Production Board"
          description="Track individual production items through the workshop."
          actions={
            <Link href="/admin/production/printfactory-unmatched">
              <Button variant="outline">PrintFactory unmatched</Button>
            </Link>
          }
        />

        <Card className="portal-surface sticky top-[4.5rem] z-10 mb-6 shadow-sm">
          <CardContent className="pt-6">
            <form
              method="get"
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"
            >
              <div className="space-y-2 md:col-span-2 2xl:col-span-2">
                <Label htmlFor="search">Search</Label>
                <Input
                  id="search"
                  name="search"
                  type="search"
                  placeholder="Job ref, item, company, machine…"
                  defaultValue={filters.search}
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
                <Label htmlFor="staff">Staff</Label>
                <Select
                  id="staff"
                  name="staff"
                  defaultValue={filters.assignedToProfileId ?? ""}
                >
                  <option value="">All staff</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name?.trim() || "Unnamed staff member"}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="machine">Machine</Label>
                <Select
                  id="machine"
                  name="machine"
                  defaultValue={filters.machine ?? ""}
                >
                  <option value="">All machines</option>
                  {filterOptions.machines.map((machine) => (
                    <option key={machine} value={machine}>
                      {machine}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="material">Material</Label>
                <Select
                  id="material"
                  name="material"
                  defaultValue={filters.material ?? ""}
                >
                  <option value="">All materials</option>
                  {filterOptions.materials.map((material) => (
                    <option key={material} value={material}>
                      {material}
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
                  {PRODUCTION_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRODUCTION_PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="due">Due date</Label>
                <Select id="due" name="due" defaultValue={filters.dueDate ?? ""}>
                  <option value="">Any due date</option>
                  <option value="overdue">Overdue</option>
                  <option value="today">Due today</option>
                  <option value="tomorrow">Due tomorrow</option>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="job_ref">Job reference</Label>
                <Input
                  id="job_ref"
                  name="job_ref"
                  placeholder="J-1048"
                  defaultValue={filters.jobReference ?? ""}
                />
              </div>

              <div className="flex flex-wrap items-end gap-2 md:col-span-2 2xl:col-span-8">
                <Button type="submit">Apply filters</Button>
                {hasFilters ? (
                  <Link href={clearHref}>
                    <Button type="button" variant="outline">
                      Clear
                    </Button>
                  </Link>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        {boardResult.queryError === "migration_required" ? (
          <Card className="portal-surface border-amber-300">
            <CardContent className="py-8">
              <EmptyState
                icon={<Factory className="h-5 w-5" aria-hidden />}
                title="Production items migration not applied"
                description="Apply supabase/migrations/20260803190000_production_items_foundation.sql in Supabase before using the Production Board."
              />
              {process.env.NODE_ENV === "development" && boardResult.detail ? (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {boardResult.detail}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : boardResult.queryError === "query_failed" ? (
          <Card className="portal-surface border-destructive/30">
            <CardContent className="py-8">
              <EmptyState
                title="Unable to load production board"
                description="Something went wrong while loading production items. Try again or contact support if the problem persists."
              />
              {process.env.NODE_ENV === "development" && boardResult.detail ? (
                <p className="mt-4 text-center text-xs text-destructive">
                  {boardResult.detail}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : boardResult.data && boardResult.data.totalCount === 0 ? (
          <Card className="portal-surface">
            <CardContent className="py-12">
              <EmptyState
                icon={<Factory className="h-5 w-5" aria-hidden />}
                title={
                  hasFilters
                    ? "No production items match your filters"
                    : "No production items yet"
                }
                description={
                  hasFilters
                    ? "Try adjusting your search or filters."
                    : "Add production items from a job detail page to populate the board."
                }
                action={
                  hasFilters ? (
                    <Link href={clearHref}>
                      <Button variant="outline">Clear filters</Button>
                    </Link>
                  ) : (
                    <Link href="/admin/jobs">
                      <Button variant="outline">View jobs</Button>
                    </Link>
                  )
                }
              />
            </CardContent>
          </Card>
        ) : boardResult.data ? (
          <>
            <div className="mb-4 text-sm text-muted-foreground">
              {boardResult.data.totalCount}{" "}
              {boardResult.data.totalCount === 1 ? "item" : "items"}
              {hasFilters ? (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    href={buildProductionBoardHref(filters)}
                    className="underline-offset-4 hover:underline"
                  >
                    Filtered view
                  </Link>
                </>
              ) : null}
            </div>
            <ProductionBoard initialData={boardResult.data} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
