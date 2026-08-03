"use client";

import Link from "next/link";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { ProductionBoardCard } from "@/lib/production/types";
import {
  PRODUCTION_PRIORITY_LABELS,
} from "@/lib/production/constants";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock } from "lucide-react";

type ProductionBoardCardViewProps = {
  card: ProductionBoardCard;
  isDragging?: boolean;
};

function DeadlineBadge({ card }: { card: ProductionBoardCard }) {
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

  if (card.is_due_tomorrow) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-medium text-yellow-800 ring-1 ring-yellow-600/15">
        Due tomorrow
      </span>
    );
  }

  if (card.is_urgent) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-600/15">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Urgent
      </span>
    );
  }

  return null;
}

export function ProductionBoardCardView({
  card,
  isDragging,
}: ProductionBoardCardViewProps) {
  const showHighlight =
    card.is_overdue || card.is_urgent || card.is_due_today;

  return (
    <Link
      href={`/admin/jobs/${card.job_id}`}
      className={cn(
        "block rounded-xl border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--candid-yellow)]",
        isDragging && "opacity-60 shadow-md ring-2 ring-[var(--candid-yellow)]",
        showHighlight && "border-amber-400/60"
      )}
      onClick={(event) => {
        if (isDragging) {
          event.preventDefault();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">
            {card.job_reference}
          </p>
          <p className="truncate text-sm font-semibold text-foreground">
            {card.item_name}
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
        {card.required_at ? (
          <p className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            Required {formatCrmDateTime(card.required_at)}
          </p>
        ) : null}
        <p>
          Priority: {PRODUCTION_PRIORITY_LABELS[card.priority]}
          {card.quantity !== null ? ` · Qty ${card.quantity}` : ""}
        </p>
        {card.machine ? <p>Machine: {card.machine}</p> : null}
        {card.material ? <p>Material: {card.material}</p> : null}
        <p>Artwork: {card.artwork_status_label}</p>
        {card.assigned_to_name ? (
          <div className="flex items-center gap-2 pt-0.5">
            <StaffAvatarDisplay fullName={card.assigned_to_name} size="sm" />
            <span>{card.assigned_to_name}</span>
          </div>
        ) : (
          <p className="text-amber-700">Unassigned</p>
        )}
      </div>
    </Link>
  );
}

export function ProductionBoardCardOverlay({ card }: { card: ProductionBoardCard }) {
  return (
    <div className="w-72 rotate-2 cursor-grabbing">
      <ProductionBoardCardView card={card} isDragging />
    </div>
  );
}
