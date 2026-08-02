"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OpportunityStage } from "@/lib/crm/types";

export type LinkableOpportunity = {
  id: string;
  title: string;
  stage: OpportunityStage;
};

type LinkQuoteToOpportunityDialogProps = {
  quoteId: string;
  quoteNumber: number;
  companyName: string;
  opportunities: LinkableOpportunity[];
  triggerLabel?: string;
};

export function LinkQuoteToOpportunityDialog({
  quoteId,
  quoteNumber,
  companyName,
  opportunities,
  triggerLabel = "Link to opportunity",
}: LinkQuoteToOpportunityDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(opportunities[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const filteredOpportunities = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return opportunities;
    }

    return opportunities.filter((opportunity) =>
      opportunity.title.toLowerCase().includes(term)
    );
  }, [opportunities, search]);

  async function handleConfirm() {
    if (!selectedId) {
      setError("Select an opportunity to link.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(
        `/api/crm/quotes/${quoteId}/link-opportunity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunityId: selectedId }),
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to link quote.");
      }

      setOpen(false);
      router.refresh();
    } catch (linkError) {
      setError(
        linkError instanceof Error
          ? linkError.message
          : "Unable to link quote."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (opportunities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open opportunities found for {companyName}. Create an opportunity
        first, then link this quote.
      </p>
    );
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Link to opportunity</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Link quote Q-{quoteNumber} to an existing opportunity for{" "}
              {companyName}. Only opportunities for this company are shown.
            </p>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="opportunitySearch">Search opportunities</Label>
                <Input
                  id="opportunitySearch"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by title…"
                />
              </div>

              <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border p-2">
                {filteredOpportunities.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    No matching opportunities.
                  </p>
                ) : (
                  filteredOpportunities.map((opportunity) => (
                    <label
                      key={opportunity.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                    >
                      <input
                        type="radio"
                        name="opportunity"
                        value={opportunity.id}
                        checked={selectedId === opportunity.id}
                        onChange={() => setSelectedId(opportunity.id)}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {opportunity.title}
                        </span>
                        <span className="mt-1 inline-block">
                          <OpportunityStageBadge stage={opportunity.stage} />
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Linking…" : "Confirm link"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type QuoteOpportunityCellProps = {
  quoteId: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  opportunityStage: OpportunityStage | null;
};

export function QuoteOpportunityCell({
  quoteId,
  opportunityId,
  opportunityTitle,
  opportunityStage,
}: QuoteOpportunityCellProps) {
  if (!opportunityId || !opportunityTitle) {
    return (
      <div className="flex flex-col gap-1 px-4 py-3.5">
        <span className="text-sm text-muted-foreground">Not linked</span>
        <Link
          href={`/admin/quotes/${quoteId}`}
          className="text-xs font-medium text-foreground hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          Link
        </Link>
      </div>
    );
  }

  return (
    <div
      className="px-4 py-3.5"
      onClick={(event) => event.stopPropagation()}
    >
      <Link
        href={`/admin/opportunities/${opportunityId}`}
        className="group block min-w-[10rem]"
      >
        <span className="block font-medium text-foreground group-hover:underline">
          {opportunityTitle}
        </span>
        {opportunityStage ? (
          <span className="mt-1 inline-block">
            <OpportunityStageBadge stage={opportunityStage} />
          </span>
        ) : null}
      </Link>
    </div>
  );
}
