import { AppShell } from "@/components/app-shell";
import { CrmMigrationPlaceholder } from "@/components/crm-migration-placeholder";
import { PageHeader } from "@/components/page-header";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { checkCrmSchemaAvailability } from "@/lib/crm-schema";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { ACTIVE_PIPELINE_STAGES } from "@/lib/crm/opportunity-stages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminOpportunitiesPage() {
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/opportunities");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const schema = await checkCrmSchemaAvailability(supabase);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title="Opportunities"
          description="Sales pipeline above quote requests and quotes."
        />

        {schema.isAvailable ? (
          <CrmMigrationPlaceholder
            title="CRM schema detected — UI coming next"
            description="The opportunities table exists. Pipeline board, list views and CRUD will be added in the next CRM phase."
            queryError={schema.errorMessage}
          />
        ) : (
          <CrmMigrationPlaceholder
            title="CRM migration required"
            description="The opportunities table is not available yet. Review and apply the proposed CRM migration in Supabase before using this area."
            queryError={schema.errorMessage}
          />
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          Planned pipeline stages:{" "}
          {ACTIVE_PIPELINE_STAGES.map((stage) =>
            stage.replaceAll("_", " ")
          ).join(" · ")}
          {" · won · lost"}
        </p>
      </div>
    </AppShell>
  );
}
