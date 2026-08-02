"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTaskStatusLabel } from "@/lib/crm/task-config";

type OpenFollowUpTask = {
  id: string;
  title: string;
  status: string;
};

type AdminQuoteFollowUpTaskPanelProps = {
  quoteId: string;
  quoteStatus: string;
  openFollowUpTasks: OpenFollowUpTask[];
};

export function AdminQuoteFollowUpTaskPanel({
  quoteId,
  quoteStatus,
  openFollowUpTasks,
}: AdminQuoteFollowUpTaskPanelProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (quoteStatus !== "accepted") {
    return null;
  }

  async function handleCompleteFollowUpTasks() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/admin/quotes/${quoteId}/complete-follow-up-tasks`,
        { method: "POST" }
      );
      const payload = (await response.json()) as {
        error?: string;
        errors?: string[];
        completedFollowUpTaskIds?: string[];
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to complete follow-up tasks.");
        setIsSubmitting(false);
        return;
      }

      if (payload.errors && payload.errors.length > 0) {
        setError(payload.errors.join(" "));
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      router.refresh();
    } catch {
      setError("Unable to complete follow-up tasks. Please try again.");
      setIsSubmitting(false);
    }
  }

  if (openFollowUpTasks.length === 0) {
    return null;
  }

  return (
    <Card className="portal-surface mb-6 overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Quote follow-up task</CardTitle>
        <CardDescription>
          Open follow-up tasks should close automatically when a quote is accepted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <ul className="space-y-2 text-sm">
          {openFollowUpTasks.map((task) => (
            <li key={task.id} className="rounded-md border border-border px-3 py-2">
              <p className="font-medium text-foreground">{task.title}</p>
              <p className="text-muted-foreground">
                Status: {formatTaskStatusLabel(task.status)}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <p className="text-sm font-medium text-amber-950">
            {openFollowUpTasks.length === 1
              ? "This follow-up task is still open."
              : "These follow-up tasks are still open."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={handleCompleteFollowUpTasks}
          >
            {isSubmitting
              ? "Completing follow-up task..."
              : "Complete follow-up task"}
          </Button>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
