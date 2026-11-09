import { LeaveStatusBadge } from "@/components/staff-leave/leave-status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LeaveRequestRow } from "@/lib/staff-leave/queries";

function formatRange(request: LeaveRequestRow) {
  if (request.start_date === request.end_date) {
    return request.start_date;
  }

  return `${request.start_date} → ${request.end_date}`;
}

export function LeaveRequestsTable({
  title,
  requests,
  emptyMessage,
}: {
  title: string;
  requests: LeaveRequestRow[];
  emptyMessage: string;
}) {
  return (
    <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {requests.length === 0 ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="divide-y divide-border">
            {requests.map((request) => (
              <article
                key={request.id}
                className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {formatRange(request)} · {request.days_requested} day
                    {request.days_requested === 1 ? "" : "s"} ({request.day_portion})
                  </p>
                  {request.employee_note ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {request.employee_note}
                    </p>
                  ) : null}
                  {request.decision_note ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Approver note: {request.decision_note}
                    </p>
                  ) : null}
                </div>
                <LeaveStatusBadge status={request.status} />
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
