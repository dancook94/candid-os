"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { getOpportunityStageOptions } from "@/lib/crm/opportunity-stages";
import type { OpportunityStage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/client";

type OpportunityStageChangeProps = {
  opportunityId: string;
  currentStage: OpportunityStage;
  currentUserId: string;
};

function buildStageTimestamps(stage: OpportunityStage) {
  const now = new Date().toISOString();

  if (stage === "won") {
    return {
      won_at: now,
      lost_at: null,
      lost_reason: null,
    };
  }

  if (stage === "lost") {
    return {
      won_at: null,
      lost_at: now,
    };
  }

  return {
    won_at: null,
    lost_at: null,
    lost_reason: null,
  };
}

export function OpportunityStageChange({
  opportunityId,
  currentStage,
  currentUserId,
}: OpportunityStageChangeProps) {
  const router = useRouter();
  const supabase = createClient();
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

    setIsSubmitting(true);

    try {
      const timestamps = buildStageTimestamps(stage);
      const { error: updateError } = await supabase
        .from("opportunities")
        .update({
          stage,
          lost_reason: stage === "lost" ? lostReason.trim() : null,
          ...timestamps,
        })
        .eq("id", opportunityId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      const { error: activityError } = await supabase
        .from("opportunity_activity")
        .insert({
          opportunity_id: opportunityId,
          activity_type: OPPORTUNITY_ACTIVITY_TYPES.stageChanged,
          description: `Stage changed from ${currentStage.replaceAll("_", " ")} to ${stage.replaceAll("_", " ")}.`,
          metadata: { from: currentStage, to: stage },
          created_by: currentUserId,
        });

      if (activityError) {
        throw new Error(activityError.message);
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
