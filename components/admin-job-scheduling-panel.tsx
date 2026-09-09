"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatJobProductionDeadline,
  requiredDateToDeadlineInput,
} from "@/lib/jobs/production-deadline";

type AdminJobSchedulingPanelProps = {
  jobId: string;
  initialRequiredDate: string | null;
};

export function AdminJobSchedulingPanel({
  jobId,
  initialRequiredDate,
}: AdminJobSchedulingPanelProps) {
  const router = useRouter();
  const [requiredDate, setRequiredDate] = useState(
    requiredDateToDeadlineInput(initialRequiredDate)
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveDeadline(nextDate: string | null) {
    setError("");
    setIsSaving(true);

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/required-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredDate: nextDate }),
      });

      const payload = (await response.json()) as {
        requiredDate?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update production deadline.");
      }

      setRequiredDate(requiredDateToDeadlineInput(payload.requiredDate ?? null));
      setIsEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update production deadline."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="portal-surface mb-6 overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Scheduling</CardTitle>
        <CardDescription>
          Production deadline for this job. Changes here do not update the original quote or
          quote request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {!isEditing ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Production deadline</p>
              <p className="mt-2 font-medium text-neutral-950">
                {formatJobProductionDeadline(initialRequiredDate)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRequiredDate(requiredDateToDeadlineInput(initialRequiredDate));
                setIsEditing(true);
              }}
            >
              {initialRequiredDate ? "Change deadline" : "Set deadline"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`job-deadline-${jobId}`}>Production deadline</Label>
              <Input
                id={`job-deadline-${jobId}`}
                type="date"
                value={requiredDate}
                onChange={(event) => setRequiredDate(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isSaving}
                onClick={() => void saveDeadline(requiredDate || null)}
              >
                Save
              </Button>
              {initialRequiredDate ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => void saveDeadline(null)}
                >
                  Clear deadline
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSaving}
                onClick={() => {
                  setRequiredDate(requiredDateToDeadlineInput(initialRequiredDate));
                  setIsEditing(false);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
