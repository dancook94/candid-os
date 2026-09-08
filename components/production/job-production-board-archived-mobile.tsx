import Link from "next/link";

import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { ArchivedProductionBoardData } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";

type JobProductionBoardArchivedMobileListProps = {
  data: ArchivedProductionBoardData;
};

export function JobProductionBoardArchivedMobileList({
  data,
}: JobProductionBoardArchivedMobileListProps) {
  if (data.totalCount === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No completed internal or non-billable jobs yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.jobs.map((job) => (
        <Link
          key={job.id}
          href={`/admin/jobs/${job.id}`}
          className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-colors active:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {job.job_reference}
              </p>
              <p className="truncate text-xs text-muted-foreground">{job.company_name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {job.project_name}
              </p>
            </div>
            {job.billing_type_label ? (
              <span
                className={cn(
                  "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                  job.job_billing_type === "internal"
                    ? "bg-slate-100 text-slate-700 ring-slate-600/10"
                    : "bg-violet-50 text-violet-800 ring-violet-600/15"
                )}
              >
                {job.billing_type_label}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Required {job.required_date ?? "—"}</span>
            <span>Completed {formatCrmDateTime(job.updated_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
