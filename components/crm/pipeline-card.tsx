"use client";

import Link from "next/link";

import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { StaffAvatarStack } from "@/components/crm/staff-avatar-stack";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { formatCrmDate, formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { PipelineCard } from "@/lib/crm/pipeline-board";
import { formatGbp } from "@/lib/format-currency";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock } from "lucide-react";

type PipelineCardViewProps = {
  card: PipelineCard;
  isDragging?: boolean;
};

export function PipelineCardView({ card, isDragging }: PipelineCardViewProps) {
  const showOverdue = card.is_follow_up_overdue || card.is_task_overdue;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow",
        isDragging && "opacity-60 shadow-md ring-2 ring-[var(--candid-yellow)]",
        showOverdue && "border-amber-400/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{card.title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {card.company_name}
          </p>
        </div>
        {card.has_urgent_task ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-600/15"
            title="Urgent task"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Urgent
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <p>
          Est.{" "}
          {card.estimated_value !== null
            ? formatGbp(card.estimated_value)
            : "—"}
          {card.current_quote_value !== null
            ? ` · Quote ${formatGbp(card.current_quote_value)}`
            : ""}
        </p>
        <div className="flex items-center gap-2">
          <StaffAvatarDisplay fullName={card.owner_name} size="sm" />
          <span>{card.owner_name}</span>
        </div>
        {card.collaborators.length > 0 ? (
          <StaffAvatarStack members={card.collaborators} maxVisible={3} size="sm" />
        ) : null}
        {card.next_incomplete_task ? (
          <p className="truncate">
            Task: {card.next_incomplete_task.title}
            {card.next_incomplete_task.due_at
              ? ` · ${formatCrmDateTime(card.next_incomplete_task.due_at)}`
              : ""}
          </p>
        ) : (
          <p className="text-amber-700">No open task scheduled</p>
        )}
        <p>
          Follow-up: {formatCrmDateTime(card.next_follow_up_at)}
        </p>
        <p className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          Updated {card.days_since_update}d ago
        </p>
      </div>

      {showOverdue ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          Overdue follow-up or task
        </p>
      ) : null}

      <div className="mt-3">
        <Link
          href={`/admin/opportunities/${card.id}`}
          className="text-xs font-medium text-foreground hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          View details
        </Link>
      </div>
    </div>
  );
}

export function PipelineCardOverlay({ card }: { card: PipelineCard }) {
  return (
    <div className="w-[18rem] rotate-2">
      <PipelineCardView card={card} isDragging />
    </div>
  );
}
