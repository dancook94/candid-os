"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  PIPELINE_QUICK_FILTERS,
  buildPipelineBoardHref,
  type PipelineBoardFilters,
} from "@/lib/crm/pipeline-board";

type PipelineQuickFiltersProps = {
  filters: PipelineBoardFilters;
  currentUserId: string;
};

function formatQuickLabel(quick: (typeof PIPELINE_QUICK_FILTERS)[number]) {
  switch (quick) {
    case "my":
      return "My opportunities";
    case "needs_follow_up":
      return "Needs follow-up";
    case "no_task":
      return "No task scheduled";
    case "closing_this_month":
      return "Closing this month";
    case "won":
      return "Won";
    case "lost":
      return "Lost";
    default:
      return quick;
  }
}

export function PipelineQuickFilters({
  filters,
}: PipelineQuickFiltersProps) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <Link href={buildPipelineBoardHref(filters, { quickFilter: null })}>
        <Button
          size="sm"
          variant={!filters.quickFilter ? "default" : "outline"}
        >
          All
        </Button>
      </Link>
      {PIPELINE_QUICK_FILTERS.map((quick) => (
        <Link
          key={quick}
          href={buildPipelineBoardHref(filters, { quickFilter: quick })}
        >
          <Button
            size="sm"
            variant={filters.quickFilter === quick ? "default" : "outline"}
          >
            {formatQuickLabel(quick)}
          </Button>
        </Link>
      ))}
    </div>
  );
}
