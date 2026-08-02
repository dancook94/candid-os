import { Card, CardContent } from "@/components/ui/card";
import { CRM_MIGRATION_DOC_PATH } from "@/lib/crm/types";

type CrmMigrationPlaceholderProps = {
  title: string;
  description?: string;
  queryError?: string | null;
};

export function CrmMigrationPlaceholder({
  title,
  description = "Apply the proposed CRM migration in Supabase before using this area.",
  queryError = null,
}: CrmMigrationPlaceholderProps) {
  return (
    <Card className="portal-surface border-dashed">
      <CardContent className="flex flex-col items-center px-4 py-10 text-center sm:px-8 sm:py-12">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {CRM_MIGRATION_DOC_PATH}
        </p>
        {queryError ? (
          <p className="mt-3 max-w-lg text-xs text-red-700">{queryError}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
