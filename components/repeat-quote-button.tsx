"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RepeatMaterialPricingMode } from "@/lib/quotes/repeat-quote";

type RepeatQuoteButtonProps = {
  quoteId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  quoteNumber: number;
};

export function RepeatQuoteButton({
  quoteId,
  sourceVersionId,
  sourceVersionNumber,
  quoteNumber,
}: RepeatQuoteButtonProps) {
  const router = useRouter();
  const dialogTitleId = useId();
  const [open, setOpen] = useState(false);
  const [materialPricingMode, setMaterialPricingMode] =
    useState<RepeatMaterialPricingMode>("refresh_catalogue");
  const [isRepeating, setIsRepeating] = useState(false);
  const [error, setError] = useState("");

  async function handleRepeat() {
    if (isRepeating) {
      return;
    }

    setError("");
    setIsRepeating(true);

    const idempotencyKey = crypto.randomUUID();

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/repeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceVersionId,
          materialPricingMode,
          idempotencyKey,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        quoteId?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.quoteId) {
        throw new Error(payload.error ?? "Unable to repeat quote.");
      }

      setOpen(false);
      router.push(`/admin/quotes/${payload.quoteId}`);
      router.refresh();
    } catch (repeatError) {
      setError(
        repeatError instanceof Error ? repeatError.message : "Unable to repeat quote."
      );
    } finally {
      setIsRepeating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="default" onClick={() => setOpen(true)}>
        Repeat quote
      </Button>

      {open ? (
        <div
          className="rounded-lg border border-border bg-background p-4 shadow-sm"
          role="dialog"
          aria-labelledby={dialogTitleId}
        >
          <p id={dialogTitleId} className="text-sm font-medium text-foreground">
            Repeat Q-{quoteNumber} (version {sourceVersionNumber})
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Creates a new quote number with draft version 1. Selling prices are copied
            unchanged; review profitability before sending.
          </p>

          <fieldset className="mt-4 space-y-2">
            <legend className="text-sm font-medium text-foreground">Material costs</legend>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="materialPricingMode"
                checked={materialPricingMode === "refresh_catalogue"}
                onChange={() => setMaterialPricingMode("refresh_catalogue")}
                disabled={isRepeating}
              />
              <span>
                Use latest approved catalogue rates (recommended)
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="materialPricingMode"
                checked={materialPricingMode === "keep_saved"}
                onChange={() => setMaterialPricingMode("keep_saved")}
                disabled={isRepeating}
              />
              <span>Keep original saved material costs</span>
            </label>
          </fieldset>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" disabled={isRepeating} onClick={handleRepeat}>
              {isRepeating ? "Creating repeat quote..." : "Create repeat quote"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isRepeating}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>

          {error ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
