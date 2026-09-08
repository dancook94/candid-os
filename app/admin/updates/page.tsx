import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { UpdateCategoryBadge } from "@/components/updates/update-category-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import {
  formatProductUpdateAudienceLabel,
  type ProductUpdateRecord,
} from "@/lib/updates/types";
import { fetchVisibleProductUpdates } from "@/lib/updates/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDate(dateString: string | null) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminUpdatesPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/updates");
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  const { updates, schemaMissing, error } = await fetchVisibleProductUpdates(
    supabase,
    {
      userRole: profile.user_role,
      includeUnpublished: true,
    }
  );

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Updates"
          description="Manage Candid OS release notes and publish improvements for staff and customers."
          actions={
            <Link href="/admin/updates/new" className={buttonVariants({ size: "lg" })}>
              Create update
            </Link>
          }
        />

        {schemaMissing ? (
          <Card className="mb-6 rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm text-amber-800">
                The Updates migration has not been applied yet.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {!schemaMissing && error ? (
          <Card className="mb-6 rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm text-red-700">{error}</p>
            </CardContent>
          </Card>
        ) : null}

        {!schemaMissing && !error && updates.length === 0 ? (
          <EmptyState
            title="No updates yet"
            description="Create your first update to share improvements with staff and customers."
            action={
              <Link href="/admin/updates/new" className={buttonVariants({ size: "lg" })}>
                Create update
              </Link>
            }
          />
        ) : !schemaMissing && !error ? (
          <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Audience</th>
                      <th>Status</th>
                      <th>Published</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(updates as ProductUpdateRecord[]).map((update) => (
                      <tr key={update.id}>
                        <td className="px-4 py-3.5 font-medium text-foreground">
                          {update.title}
                        </td>
                        <td className="px-4 py-3.5">
                          <UpdateCategoryBadge category={update.category} />
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatProductUpdateAudienceLabel(update.audience)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {update.is_published ? "Published" : "Draft"}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatDate(update.published_at)}
                        </td>
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/admin/updates/${update.id}`}
                            className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
