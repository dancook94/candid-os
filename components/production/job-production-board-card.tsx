"use client";

import Link from "next/link";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import { StatusBadge } from "@/components/status-badge";
import { ProductionBoardPrintfactoryPreview } from "@/components/production/production-board-printfactory-preview";
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
        (card.is_overdue || card.is_due_today) && "border-amber-400/60",
        card.readiness_is_ready && card.production_board_stage === "accepted_quotes" &&
          "border-emerald-400/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {card.job_reference}
            </p>
            {card.billing_type_label &&
            card.job_billing_type &&
            card.job_billing_type !== "billable" ? (
              <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-600/10">
                {card.billing_type_label}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {card.company_name}
          </p>
        </div>
        <DeadlineBadge card={card} />
      </div>

      <p className="mt-2 truncate text-xs text-muted-foreground">
        {card.project_name}
      </p>

      {card.preview_thumbnail_url ? (
        <div className="mt-3">
          {card.preview_is_shared_print ? (
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Shared print
            </p>
          ) : null}
          <ProductionBoardPrintfactoryPreview
            jobGuid={card.preview_printfactory_job_guid}
            thumbnailUrl={card.preview_thumbnail_url}
            alt={card.preview_thumbnail_alt ?? card.job_reference}
            outputPageCount={card.preview_output_page_count}
          />
        </div>
      ) : null}

      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {card.required_date ? (
          <p className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            Required {card.required_date}
            {card.fulfilment_method ? ` · ${card.fulfilment_method}` : ""}
          </p>
        ) : card.fulfilment_method ? (
          <p>{card.fulfilment_method}</p>
        ) : null}
        {card.priority_label ? <p>Priority: {card.priority_label}</p> : null}
        {card.assigned_staff_name ? <p>Assigned: {card.assigned_staff_name}</p> : null}
        <p>Artwork: {card.artwork_status_label}</p>
        <div className="flex items-center gap-2">
          <span>Proof:</span>
          <StatusBadge status={card.proof_status_badge} label={card.proof_status_label} />
        </div>
        <p>Production readiness: {card.readiness_label}</p>
        {card.readiness_unresolved_details.length > 0 ? (
          <div className="space-y-0.5">
            {card.readiness_unresolved_details.map((detail) => (
              <p key={detail} className="text-amber-900/90">
                Unresolved: {detail}
              </p>
            ))}
          </div>
        ) : null}
        <p>
          Ripped: {card.ripped_requirements_count} of {card.readiness_active || "0"}
        </p>
        {card.files_detected_count > 0 ? (
          <p>PrintFactory files: {card.files_detected_count}</p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
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
          PrintFactory
        </Link>
        {card.quote_id ? (
          <Link
            href={`/admin/quotes/${card.quote_id}`}
            className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
          >
            Quote
          </Link>
        ) : null}
        {card.opportunity_id ? (
          <Link
            href={`/admin/opportunities/${card.opportunity_id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
          >
            Opportunity
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
        {card.dropbox_folder_path ? (
          <span className="text-xs text-muted-foreground" title={card.dropbox_folder_path}>
            Dropbox linked
          </span>
        ) : null}
        {card.synology_path_hint ? (
          <span
            className="max-w-[10rem] truncate text-xs text-muted-foreground"
            title={card.synology_path_hint}
          >
            Synology path
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground/80">
        Updated {formatCrmDateTime(card.updated_at)}
      </p>
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
