"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { TaskStatusBadge } from "@/components/crm/task-badges";
import { Button } from "@/components/ui/button";
import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import type { TaskStatus } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/client";

type TaskStatusToggleProps = {
  taskId: string;
  taskTitle: string;
  status: TaskStatus;
  opportunityId: string | null;
  currentUserId: string;
};

export function TaskStatusToggle({
  taskId,
  taskTitle,
  status,
  opportunityId,
  currentUserId,
}: TaskStatusToggleProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function toggleCompletion() {
    setError("");
    setIsSubmitting(true);

    const nextStatus = status === "completed" ? "open" : "completed";
    const completedAt =
      nextStatus === "completed" ? new Date().toISOString() : null;

    try {
      const { error: updateError } = await supabase
        .from("tasks")
        .update({
          status: nextStatus,
          completed_at: completedAt,
        })
        .eq("id", taskId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (opportunityId) {
        const activityType =
          nextStatus === "completed"
            ? OPPORTUNITY_ACTIVITY_TYPES.taskCompleted
            : OPPORTUNITY_ACTIVITY_TYPES.taskReopened;
        const description =
          nextStatus === "completed"
            ? `Task "${taskTitle}" completed.`
            : `Task "${taskTitle}" reopened.`;

        const { error: activityError } = await supabase
          .from("opportunity_activity")
          .insert({
            opportunity_id: opportunityId,
            activity_type: activityType,
            description,
            metadata: { task_id: taskId },
            created_by: currentUserId,
          });

        if (activityError) {
          throw new Error(activityError.message);
        }
      }

      router.refresh();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update task."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <TaskStatusBadge status={status} />
      {status !== "cancelled" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggleCompletion}
          disabled={isSubmitting}
        >
          {isSubmitting
            ? "Updating…"
            : status === "completed"
              ? "Reopen task"
              : "Mark completed"}
        </Button>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
