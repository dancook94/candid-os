"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmTextMatchDialog } from "@/components/crm/confirm-text-match-dialog";
import type { OpportunityBlockingTask } from "@/lib/crm/opportunity-delete";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DeleteOpportunitySectionProps = {
  opportunityId: string;
  opportunityTitle: string;
  companyName: string;
  canDelete: boolean;
  blockReason: string | null;
  blockingTasks: OpportunityBlockingTask[];
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

export function DeleteOpportunitySection({
  opportunityId,
  opportunityTitle,
  companyName,
  canDelete,
  blockReason,
  blockingTasks,
}: DeleteOpportunitySectionProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function handlePermanentDelete() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/opportunities/${opportunityId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationTitle: confirmationTitle.trim() }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to delete this opportunity.");
        setIsSubmitting(false);
        return;
      }

      router.push("/admin/opportunities");
      router.refresh();
    } catch {
      setError("Unable to delete this opportunity. Please try again.");
      setIsSubmitting(false);
    }
  }

  function handleRefreshBlockers() {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 500);
  }

  return (
    <>
      <Card className="portal-surface mt-8 border-red-200">
        <CardHeader className="border-b border-red-200/70">
          <CardTitle className="text-lg font-semibold text-red-900">
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently delete this opportunity and remove its CRM links. This
            cannot be undone.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          {blockReason ? (
            <p className="text-sm text-muted-foreground">{blockReason}</p>
          ) : null}

          {blockingTasks.length > 0 ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">
                Blocking tasks
              </p>
              <ul className="space-y-3">
                {blockingTasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-lg border border-border bg-background p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <Link
                          href={`/admin/tasks/${task.id}/edit`}
                          className="font-medium text-foreground underline"
                        >
                          {task.title}
                        </Link>
                        <p className="text-muted-foreground">
                          {formatTaskStatus(task.status)} ·{" "}
                          {formatDueDate(task.dueAt)}
                        </p>
                        <p className="text-muted-foreground">
                          Assignees:{" "}
                          {task.assigneeNames.length > 0
                            ? task.assigneeNames.join(", ")
                            : "Unassigned"}
                        </p>
                      </div>
                      <Link href={`/admin/tasks/${task.id}/edit`}>
                        <Button type="button" variant="outline" size="sm">
                          Edit task
                        </Button>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRefreshing}
                onClick={handleRefreshBlockers}
              >
                {isRefreshing ? "Refreshing..." : "Refresh blockers"}
              </Button>
            </div>
          ) : null}

          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete || isSubmitting}
            onClick={() => {
              setError("");
              setConfirmationTitle("");
              setConfirmOpen(true);
            }}
          >
            Permanently delete opportunity
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
        title="Permanently delete opportunity"
        description={
          <>
            Delete <span className="font-medium">{opportunityTitle}</span> for{" "}
            <span className="font-medium">{companyName}</span>? This action
            cannot be undone.
          </>
        }
        confirmationLabel={
          <>
            Type <span className="font-mono">{opportunityTitle}</span> to confirm
          </>
        }
        confirmationValue={confirmationTitle}
        confirmText={opportunityTitle}
        onConfirmationChange={setConfirmationTitle}
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
