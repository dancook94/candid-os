"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getOpportunityStageOptions } from "@/lib/crm/opportunity-stages";
import type { OpportunityStage } from "@/lib/crm/types";

type OpportunityStageChangeProps = {
  opportunityId: string;
  currentStage: OpportunityStage;
};

export function OpportunityStageChange({
  opportunityId,
  currentStage,
}: OpportunityStageChangeProps) {
  const router = useRouter();
  const [stage, setStage] = useState<OpportunityStage>(currentStage);
  const [lostReason, setLostReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setError("");

    if (stage === currentStage) {
      return;
    }

    if (stage === "lost" && !lostReason.trim()) {
      setError("Lost reason is required when stage is Lost.");
      return;
    }

    const isTerminalMove =
      stage === "won" ||
      stage === "lost" ||
      currentStage === "won" ||
      currentStage === "lost";

    if (
      isTerminalMove &&
      !window.confirm("Confirm this stage change?")
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/crm/opportunities/${opportunityId}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage,
            previousStage: currentStage,
            lostReason: stage === "lost" ? lostReason.trim() : null,
            confirmed: isTerminalMove,
          }),
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to change stage.");
      }

      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to change stage."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Current stage</span>
        <OpportunityStageBadge stage={currentStage} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor="quickStage">Change stage</Label>
          <Select
            id="quickStage"
            value={stage}
            onChange={(event) =>
              setStage(event.target.value as OpportunityStage)
            }
          >
            {getOpportunityStageOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || stage === currentStage}
        >
          {isSubmitting ? "Updating…" : "Update stage"}
        </Button>
      </div>

      {stage === "lost" ? (
        <div className="space-y-2">
          <Label htmlFor="quickLostReason">Lost reason</Label>
          <Textarea
            id="quickLostReason"
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value)}
            rows={3}
          />
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
