import { AppShell } from "@/components/app-shell";
import { CrmMigrationPlaceholder } from "@/components/crm-migration-placeholder";
import { PageHeader } from "@/components/page-header";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { checkCrmSchemaAvailability } from "@/lib/crm-schema";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminTasksPage() {
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/tasks");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const schema = await checkCrmSchemaAvailability(supabase);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title="Tasks"
          description="Follow-ups and actions linked to opportunities and quotes."
        />

        {schema.isAvailable ? (
          <CrmMigrationPlaceholder
            title="CRM schema detected — UI coming next"
            description="The tasks table exists. Task lists, filters and creation flows will be added in the next CRM phase."
            queryError={schema.errorMessage}
          />
        ) : (
          <CrmMigrationPlaceholder
            title="CRM migration required"
            description="The tasks table is not available yet. Review and apply the proposed CRM migration in Supabase before using this area."
            queryError={schema.errorMessage}
          />
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          Open task statuses: {OPEN_TASK_STATUSES.join(", ").replaceAll("_", " ")}.
        </p>
      </div>
    </AppShell>
  );
}
