"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";

import {
  ProductionBoardFilterActions,
  ProductionBoardFilterFields,
} from "@/components/production/production-board-filter-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasActiveProductionBoardFilters } from "@/lib/production/board";
import type { ProductionBoardFilters } from "@/lib/production/types";

type ProductionBoardMobileControlsProps = {
  filters: ProductionBoardFilters;
  clearHref: string;
  isArchivedView: boolean;
  companies: Array<{ id: string; company_name: string }>;
  staff: Array<{ id: string; full_name: string | null }>;
  machines: string[];
  materials: string[];
};

function countActiveFilters(filters: ProductionBoardFilters) {
  let count = 0;

  if (filters.companyId) count += 1;
  if (filters.assignedToProfileId) count += 1;
  if (filters.machine) count += 1;
  if (filters.material) count += 1;
  if (filters.priority) count += 1;
  if (filters.dueDate) count += 1;
  if (filters.jobReference) count += 1;

  return count;
}

export function ProductionBoardMobileControls({
  filters,
  clearHref,
  isArchivedView,
  companies,
  staff,
  machines,
  materials,
}: ProductionBoardMobileControlsProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasFilters = hasActiveProductionBoardFilters(filters);
  const activeFilterCount = countActiveFilters(filters);

  useEffect(() => {
    if (!filtersOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFiltersOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filtersOpen]);

  return (
    <div className="space-y-3">
      <form method="get" className="flex items-end gap-2">
        {isArchivedView ? <input type="hidden" name="view" value="archived" /> : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="mobile-production-search" className="sr-only">
            Search production board
          </Label>
          <Input
            id="mobile-production-search"
            name="search"
            type="search"
            placeholder="Search jobs…"
            defaultValue={filters.search}
            className="h-11"
          />
        </div>
        <Button type="submit" className="h-11 shrink-0 px-4">
          Search
        </Button>
        <Button
          type="button"
          variant="outline"
          className="relative h-11 shrink-0 px-3"
          aria-label="Open production board filters"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          {activeFilterCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--candid-yellow)] px-1 text-[10px] font-semibold text-neutral-950">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </form>

      {filtersOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <button
            type="button"
            aria-label="Close filters"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={() => setFiltersOpen(false)}
          />

          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Production board filters"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Filters</p>
                <p className="text-xs text-muted-foreground">
                  Refine the jobs shown on the production board.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setFiltersOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <form method="get" className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
                <ProductionBoardFilterFields
                  filters={filters}
                  isArchivedView={isArchivedView}
                  companies={companies}
                  staff={staff}
                  machines={machines}
                  materials={materials}
                  idPrefix="mobile"
                />
              </div>

              <div className="flex shrink-0 gap-2 border-t border-border px-4 py-4">
                <ProductionBoardFilterActions
                  hasFilters={hasFilters}
                  clearHref={clearHref}
                  className="flex w-full gap-2 [&>a]:flex-1 [&>button]:flex-1"
                  onApply={() => setFiltersOpen(false)}
                />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
