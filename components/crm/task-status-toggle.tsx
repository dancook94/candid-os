"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { TaskStatusBadge } from "@/components/crm/task-badges";
import { Button } from "@/components/ui/button";
import type { TaskStatus } from "@/lib/crm/types";

type TaskStatusToggleProps = {
  taskId: string;
  status: TaskStatus;
};

export function TaskStatusToggle({
  taskId,
  status,
}: TaskStatusToggleProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function toggleCompletion() {
    setError("");
    setIsSubmitting(true);

    const nextStatus = status === "completed" ? "open" : "completed";

    try {
      const response = await fetch(`/api/crm/tasks/${taskId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update task.");
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
