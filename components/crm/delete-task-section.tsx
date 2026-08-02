"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmTextMatchDialog } from "@/components/crm/confirm-text-match-dialog";
import type { TaskDeleteContext } from "@/lib/crm/task-delete";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DeleteTaskSectionProps = {
  task: TaskDeleteContext;
};

function formatTaskStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDueDate(dueAt: string | null) {
  if (!dueAt) {
    return "No due date";
  }

  return new Date(dueAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DeleteTaskSection({ task }: DeleteTaskSectionProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isCompleted = task.status === "completed";

  async function handlePermanentDelete() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/tasks/${task.taskId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationTitle: confirmationText.trim() }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to delete this task.");
        setIsSubmitting(false);
        return;
      }

      router.push("/admin/tasks");
      router.refresh();
    } catch {
      setError("Unable to delete this task. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Card className="portal-surface mt-8 border-red-200">
        <CardHeader className="border-b border-red-200/70">
          <CardTitle className="text-lg font-semibold text-red-900">
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently delete this task and remove its CRM links. This cannot be
            undone.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          {isCompleted ? (
            <p className="text-sm text-amber-900">
              This task is completed and forms part of your historical CRM
              record. Deleting it will preserve activity history but remove the
              task itself.
            </p>
          ) : null}

          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting}
            onClick={() => {
              setError("");
              setConfirmationText("");
              setConfirmOpen(true);
            }}
          >
            Permanently delete task
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ConfirmTextMatchDialog
        open={confirmOpen}
        title="Permanently delete task"
        description={
          <div className="space-y-3 text-sm">
            {isCompleted ? (
              <p className="font-medium text-amber-900">
                Warning: this completed task is part of your historical CRM
                records.
              </p>
            ) : null}
            <p>
              Delete <span className="font-medium">{task.title}</span>? This
              action cannot be undone.
            </p>
            <dl className="grid gap-2 text-muted-foreground">
              <div>
                <dt className="font-medium text-foreground">Status</dt>
                <dd>{formatTaskStatus(task.status)}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Due date</dt>
                <dd>{formatDueDate(task.dueAt)}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Assignees</dt>
                <dd>{task.assigneeNames.join(", ") || "Unassigned"}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Linked opportunity</dt>
                <dd>
                  {task.opportunityTitle ? (
                    task.opportunityId ? (
                      <Link
                        href={`/admin/opportunities/${task.opportunityId}`}
                        className="underline"
                      >
                        {task.opportunityTitle}
                      </Link>
                    ) : (
                      task.opportunityTitle
                    )
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Linked quote</dt>
                <dd>
                  {task.quoteLabel ? (
                    task.quoteId ? (
                      <Link
                        href={`/admin/quotes/${task.quoteId}`}
                        className="underline"
                      >
                        {task.quoteLabel}
                      </Link>
                    ) : (
                      task.quoteLabel
                    )
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
            </dl>
          </div>
        }
        confirmationValue={confirmationText}
        onConfirmationChange={setConfirmationText}
        confirmLabel="Delete permanently"
        confirmingLabel="Deleting..."
        isSubmitting={isSubmitting}
        onCancel={() => {
          if (!isSubmitting) {
            setConfirmOpen(false);
          }
        }}
        onConfirm={handlePermanentDelete}
        destructive
      />
    </>
  );
}
