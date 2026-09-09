"use client";

import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

import { JobProductionBoardDeadlineControl } from "@/components/production/job-production-board-deadline-control";
import { ProductionBoardPrintfactoryPreview } from "@/components/production/production-board-printfactory-preview";
import { formatProductionBoardDeadline } from "@/lib/jobs/production-deadline";
import { JOB_PRODUCTION_BOARD_STAGE_LABELS } from "@/lib/production/job-board-constants";
import { resolveJobProductionBoardCardStage } from "@/lib/production/job-board-mobile";
import type { JobProductionBoardCard } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";

type JobProductionBoardMobileCardProps = {
  card: JobProductionBoardCard;
};

function DeadlineSummary({ card }: { card: JobProductionBoardCard }) {
  if (card.is_on_hold) {
    return <span className="text-xs font-medium text-slate-700">On hold</span>;
  }

  if (card.is_overdue) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Overdue
      </span>
    );
  }

  if (card.is_due_today) {
    return <span className="text-xs font-medium text-amber-800">Due today</span>;
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {formatProductionBoardDeadline(card.required_date)}
      {card.required_date && card.fulfilment_method ? ` · ${card.fulfilment_method}` : ""}
    </span>
  );
}

export function JobProductionBoardMobileCard({ card }: JobProductionBoardMobileCardProps) {
  const stage = resolveJobProductionBoardCardStage(card);

  return (
    <Link
      href={`/admin/jobs/${card.id}`}
      className={cn(
        "block rounded-xl border border-border bg-card p-3 shadow-sm transition-colors active:bg-muted/40",
        (card.is_overdue || card.is_due_today) && "border-amber-400/60",
        card.readiness_is_ready &&
          card.production_board_stage === "accepted_quotes" &&
          "border-emerald-400/50"
      )}
    >
      <div className="flex gap-3">
        {card.preview_thumbnail_url ? (
          <div className="w-20 shrink-0">
            {card.preview_is_shared_print ? (
              <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                Shared
              </p>
            ) : null}
            <ProductionBoardPrintfactoryPreview
              jobGuid={card.preview_printfactory_job_guid}
              thumbnailUrl={card.preview_thumbnail_url}
              alt={card.preview_thumbnail_alt ?? card.job_reference}
              outputPageCount={card.preview_output_page_count}
              maxHeightClassName="max-h-20"
              className="w-20"
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {card.job_reference}
              </p>
              <p className="truncate text-xs text-muted-foreground">{card.company_name}</p>
            </div>
            {card.billing_type_label &&
            card.job_billing_type &&
            card.job_billing_type !== "billable" ? (
              <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-600/10">
                {card.billing_type_label}
              </span>
            ) : null}
          </div>

          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {card.project_name}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
              {JOB_PRODUCTION_BOARD_STAGE_LABELS[stage]}
            </span>
            {card.priority_label ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {card.priority_label}
              </span>
            ) : null}
          </div>

          <div className="mt-2 space-y-1">
            <DeadlineSummary card={card} />
            <div
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <JobProductionBoardDeadlineControl card={card} />
            </div>
          </div>

          {card.readiness_unresolved_details.length > 0 ? (
            <p className="mt-2 line-clamp-2 text-[11px] text-amber-900/90">
              {card.readiness_unresolved_details[0]}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
