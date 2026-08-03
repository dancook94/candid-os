"use client";

import Link from "next/link";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { JobProductionBoardCard } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, ExternalLink } from "lucide-react";

type JobProductionBoardCardViewProps = {
  card: JobProductionBoardCard;
  isDragging?: boolean;
};

function DeadlineBadge({ card }: { card: JobProductionBoardCard }) {
  if (card.is_on_hold) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-600/10">
        On hold
      </span>
    );
  }

  if (card.is_overdue) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-600/15">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Overdue
      </span>
    );
  }

  if (card.is_due_today) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-600/15">
        Due today
      </span>
    );
  }

  return null;
}

export function JobProductionBoardCardView({
  card,
  isDragging,
}: JobProductionBoardCardViewProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        isDragging && "opacity-60 shadow-md ring-2 ring-[var(--candid-yellow)]",
        (card.is_overdue || card.is_due_today) && "border-amber-400/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {card.job_reference}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {card.company_name}
          </p>
        </div>
        <DeadlineBadge card={card} />
      </div>

      <p className="mt-2 truncate text-xs text-muted-foreground">
        {card.project_name}
      </p>

      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {card.required_date ? (
          <p className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            Deadline {card.required_date}
          </p>
        ) : null}
        <p>Artwork: {card.artwork_status_label}</p>
        <p>
          Production readiness: {card.readiness_label}
        </p>
        <p>Ripped requirements: {card.ripped_requirements_count}</p>
        <p>
          Dropbox: {card.dropbox_setup_status}
          {card.dropbox_folder_path ? " · linked" : ""}
        </p>
        {card.fulfilment_method ? (
          <p>Delivery: {card.fulfilment_method}</p>
        ) : null}
        <p className="text-[10px] text-muted-foreground/80">
          Updated {formatCrmDateTime(card.updated_at)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/admin/jobs/${card.id}`}
          className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
        >
          Open job
        </Link>
        <Link
          href={`/admin/production/printfactory-unmatched?job=${card.job_reference}`}
          className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
        >
          Match PrintFactory
        </Link>
        {card.opportunity_id ? (
          <Link
            href={`/admin/opportunities/${card.opportunity_id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
          >
            Opportunity
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function JobProductionBoardCardOverlay({
  card,
}: {
  card: JobProductionBoardCard;
}) {
  return (
    <div className="w-72 rotate-2 cursor-grabbing">
      <JobProductionBoardCardView card={card} isDragging />
    </div>
  );
}
