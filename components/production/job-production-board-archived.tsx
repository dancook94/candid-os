import Link from "next/link";

import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { ArchivedProductionBoardData } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";

type JobProductionBoardArchivedListProps = {
  data: ArchivedProductionBoardData;
};

export function JobProductionBoardArchivedList({
  data,
}: JobProductionBoardArchivedListProps) {
  if (data.totalCount === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No completed internal or non-billable jobs yet.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="portal-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Project</th>
              <th>Company</th>
              <th>Type</th>
              <th>Required date</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => (
              <tr key={job.id} className="hover:bg-muted/35">
                <td className="p-4 font-medium text-foreground">
                  <Link
                    href={`/admin/jobs/${job.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {job.job_reference}
                  </Link>
                </td>
                <td className="p-4 text-muted-foreground">{job.project_name}</td>
                <td className="p-4 text-muted-foreground">{job.company_name}</td>
                <td className="p-4">
                  {job.billing_type_label ? (
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                        job.job_billing_type === "internal"
                          ? "bg-slate-100 text-slate-700 ring-slate-600/10"
                          : "bg-violet-50 text-violet-800 ring-violet-600/15"
                      )}
                    >
                      {job.billing_type_label}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-4 text-muted-foreground">
                  {job.required_date ?? "—"}
                </td>
                <td className="p-4 text-muted-foreground">
                  {formatCrmDateTime(job.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
