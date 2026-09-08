import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import {
  formatProblemReportPriorityLabel,
  formatProblemReportStatusLabel,
  type ProblemReportRecord,
} from "@/lib/updates/types";
import { summarizeProblemReportDescription } from "@/lib/problem-reports/queries";

type YourReportsListProps = {
  reports: ProblemReportRecord[];
};

const statusVariantMap = {
  reported: "pending",
  reviewing: "sent",
  planned: "draft",
  in_progress: "sent",
  fixed: "accepted",
  closed: "disabled",
} as const;

function formatSubmittedDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function YourReportsList({ reports }: YourReportsListProps) {
  return (
    <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Your reports</CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {reports.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">
            You have not submitted any problem reports yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Issue</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatSubmittedDate(report.created_at)}
                    </td>
                    <td className="px-4 py-3.5">
                      {summarizeProblemReportDescription(report.description)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatProblemReportPriorityLabel(report.priority)}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        status={statusVariantMap[report.status]}
                        label={formatProblemReportStatusLabel(report.status)}
                      />
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
