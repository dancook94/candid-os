import Link from "next/link";
import { Factory } from "lucide-react";

import { JobProductionBoard } from "@/components/production/job-production-board";
import { JobProductionBoardMobile } from "@/components/production/job-production-board-mobile";
import { JobProductionBoardArchivedList } from "@/components/production/job-production-board-archived";
import { JobProductionBoardArchivedMobileList } from "@/components/production/job-production-board-archived-mobile";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ProductionBoardMobileControls } from "@/components/production/production-board-mobile-controls";
import {
  ProductionBoardFilterActions,
  ProductionBoardFilterFields,
} from "@/components/production/production-board-filter-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import {
  buildProductionBoardHref,
  hasActiveProductionBoardFilters,
  parseProductionBoardFilters,
  type ProductionBoardSearchParams,
} from "@/lib/production/board";
import {
  fetchArchivedProductionBoardJobs,
  fetchJobProductionBoard,
} from "@/lib/production/job-board-service";
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
  const isArchivedView = filters.boardView === "archived";

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/production");
  const shellProps = await buildCrmAppShellProps(supabase, profile);
  const adminClient = createAdminClient();

  const [boardResult, archivedResult, { data: activeCompanies }, staff, filterOptions] =
    await Promise.all([
      isArchivedView
        ? Promise.resolve({ data: null, queryError: null as null, detail: null as null })
        : fetchJobProductionBoard(adminClient, filters),
      isArchivedView
        ? fetchArchivedProductionBoardJobs(adminClient, filters)
        : Promise.resolve({ data: null, queryError: null as null, detail: null as null }),
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
      loadProductionStaffProfiles(supabase),
      loadProductionFilterOptions(adminClient),
    ]);

  const clearHref = buildProductionBoardHref({
    ...filters,
    search: "",
    companyId: null,
    assignedToProfileId: null,
    machine: null,
    material: null,
    priority: null,
    dueDate: null,
    jobReference: null,
  });
  const activeBoardHref = buildProductionBoardHref({ ...filters, boardView: "active" });
  const archivedBoardHref = buildProductionBoardHref({ ...filters, boardView: "archived" });

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-[100rem]">
        <PageHeader
          eyebrow="Production"
          title={isArchivedView ? "Completed / Archived Jobs" : "Production Board"}
          description={
            isArchivedView
              ? "Internal and non-billable jobs removed from the active board after production completion. Full job history is retained."
              : "Track whole jobs through production from accepted quote to dispatch."
          }
          actions={
            <div className="flex flex-wrap gap-2">
              {isArchivedView ? (
                <Link href={activeBoardHref}>
                  <Button variant="outline">Active Production Board</Button>
                </Link>
              ) : (
                <Link href={archivedBoardHref}>
                  <Button variant="outline">Completed / Archived</Button>
                </Link>
              )}
              <Link href="/admin/production/printfactory-unmatched">
                <Button variant="outline">PrintFactory Matching</Button>
              </Link>
            </div>
          }
        />

        <div className="hidden lg:block">
          <Card className="portal-surface sticky top-[4.5rem] z-10 mb-6 shadow-sm">
            <CardContent className="pt-6">
              <form
                method="get"
                className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"
              >
                <ProductionBoardFilterFields
                  filters={filters}
                  isArchivedView={isArchivedView}
                  companies={activeCompanies ?? []}
                  staff={staff}
                  machines={filterOptions.machines}
                  materials={filterOptions.materials}
                />

                <ProductionBoardFilterActions
                  hasFilters={hasFilters}
                  clearHref={clearHref}
                  className="flex flex-wrap items-end gap-2 md:col-span-2 2xl:col-span-8"
                />
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="mb-4 lg:hidden">
          <ProductionBoardMobileControls
            filters={filters}
            clearHref={clearHref}
            isArchivedView={isArchivedView}
            companies={activeCompanies ?? []}
            staff={staff}
            machines={filterOptions.machines}
            materials={filterOptions.materials}
          />
        </div>

        {isArchivedView ? (
          archivedResult.queryError === "migration_required" ? (
            <Card className="portal-surface border-amber-300">
              <CardContent className="py-8">
                <EmptyState
                  icon={<Factory className="h-5 w-5" aria-hidden />}
                  title="Production Board migration not applied"
                  description="Apply supabase/migrations/20260803220000_printfactory_production_board_phase2.sql (and earlier production migrations) in Supabase before using the Production Board."
                />
              </CardContent>
            </Card>
          ) : archivedResult.queryError === "query_failed" ? (
            <Card className="portal-surface border-destructive/30">
              <CardContent className="py-8">
                <EmptyState
                  title="Unable to load archived jobs"
                  description="Something went wrong while loading completed jobs. Try again or contact support if the problem persists."
                />
              </CardContent>
            </Card>
          ) : archivedResult.data && archivedResult.data.totalCount === 0 ? (
            <Card className="portal-surface">
              <CardContent className="py-12">
                <EmptyState
                  icon={<Factory className="h-5 w-5" aria-hidden />}
                  title={
                    hasFilters
                      ? "No archived jobs match your filters"
                      : "No archived jobs yet"
                  }
                  description={
                    hasFilters
                      ? "Try adjusting your search or filters."
                      : "Internal and non-billable jobs appear here after they are moved to Complete Job."
                  }
                  action={
                    hasFilters ? (
                      <Link href={clearHref}>
                        <Button variant="outline">Clear filters</Button>
                      </Link>
                    ) : (
                      <Link href={activeBoardHref}>
                        <Button variant="outline">Active Production Board</Button>
                      </Link>
                    )
                  }
                />
              </CardContent>
            </Card>
          ) : archivedResult.data ? (
            <>
              <div className="mb-4 text-sm text-muted-foreground">
                {archivedResult.data.totalCount}{" "}
                {archivedResult.data.totalCount === 1 ? "job" : "jobs"} archived
              </div>
            <div className="hidden lg:block">
              <JobProductionBoardArchivedList data={archivedResult.data} />
            </div>
            <div className="lg:hidden">
              <JobProductionBoardArchivedMobileList data={archivedResult.data} />
            </div>
            </>
          ) : null
        ) : boardResult.queryError === "migration_required" ? (
          <Card className="portal-surface border-amber-300">
            <CardContent className="py-8">
              <EmptyState
                icon={<Factory className="h-5 w-5" aria-hidden />}
                title="Production Board migration not applied"
                description="Apply supabase/migrations/20260803220000_printfactory_production_board_phase2.sql (and earlier production migrations) in Supabase before using the Production Board."
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
                    ? "No jobs match your filters"
                    : "No jobs on the board yet"
                }
                description={
                  hasFilters
                    ? "Try adjusting your search or filters."
                    : "Accepted quotes create jobs automatically in Accepted Quotes."
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
              {boardResult.data.totalCount === 1 ? "job" : "jobs"}
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
            <div className="hidden lg:block">
              <JobProductionBoard initialData={boardResult.data} />
            </div>
            <div className="lg:hidden">
              <JobProductionBoardMobile initialData={boardResult.data} />
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
