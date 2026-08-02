import { Card, CardContent } from "@/components/ui/card";
import type { CrmSummaryMetrics } from "@/lib/crm/crm-reporting";
import { formatGbp } from "@/lib/format-currency";

type CrmSummaryCardsProps = {
  metrics: CrmSummaryMetrics;
};

export function CrmSummaryCards({ metrics }: CrmSummaryCardsProps) {
  const items = [
    {
      label: "Active pipeline value",
      value: formatGbp(metrics.activePipelineValue),
    },
    {
      label: "Quote sent value",
      value: formatGbp(metrics.quoteSentValue),
    },
    { label: "Won value", value: formatGbp(metrics.wonValue) },
    { label: "Lost value", value: formatGbp(metrics.lostValue) },
    {
      label: "Needs follow-up",
      value: String(metrics.needsFollowUpCount),
    },
    {
      label: "Overdue tasks",
      value: String(metrics.overdueTasksCount),
    },
  ];

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} className="portal-surface">
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {item.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
