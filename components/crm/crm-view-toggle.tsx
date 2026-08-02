"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

type CrmViewToggleProps = {
  listHref: string;
  pipelineHref: string;
  activeView: "list" | "pipeline";
};

export function CrmViewToggle({
  listHref,
  pipelineHref,
  activeView,
}: CrmViewToggleProps) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
      <Link
        href={listHref}
        className={cn(
          "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          activeView === "list"
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        List
      </Link>
      <Link
        href={pipelineHref}
        className={cn(
          "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          activeView === "pipeline"
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Pipeline
      </Link>
    </div>
  );
}

export function useCrmViewToggleHref(
  basePath: string,
  currentFiltersQuery: string,
  view: "list" | "pipeline"
) {
  const params = new URLSearchParams(currentFiltersQuery);
  params.set("view", view);
  return `${basePath}?${params.toString()}`;
}
