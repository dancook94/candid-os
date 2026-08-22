"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { NotificationListItem } from "@/lib/notifications/list";

type NotificationsListClientProps = {
  items: NotificationListItem[];
  totalCount: number;
  schemaMissing: boolean;
  canRetry: boolean;
};

function notificationStatusBadge(status: string) {
  switch (status) {
    case "sent":
    case "delivered":
      return { status: "sent" as const, label: status };
    case "failed":
    case "bounced":
      return { status: "declined" as const, label: status };
    case "suppressed":
    case "cancelled":
      return { status: "disabled" as const, label: status };
    default:
      return { status: "pending" as const, label: status };
  }
}

export function NotificationsListClient({
  items,
  totalCount,
  schemaMissing,
  canRetry,
}: NotificationsListClientProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  async function retryNotification(id: string) {
    setBusyId(id);
    setActionError("");

    try {
      const response = await fetch(`/api/admin/notifications/${id}/retry`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Retry failed.");
      }

      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (schemaMissing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notification log unavailable</CardTitle>
          <CardDescription>
            Apply the notifications migration in Supabase to enable delivery logging.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {actionError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Delivery log</CardTitle>
          <CardDescription>{totalCount} notification{totalCount === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Audience</th>
                <th className="py-2 pr-4">Intended recipient</th>
                <th className="py-2 pr-4">Actual recipient</th>
                <th className="py-2 pr-4">Subject</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-muted-foreground">
                    No notifications logged yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="py-3 pr-4">{item.notificationTypeLabel}</td>
                    <td className="py-3 pr-4 capitalize">{item.audience}</td>
                    <td className="py-3 pr-4">{item.intendedRecipientEmail ?? "—"}</td>
                    <td className="py-3 pr-4">{item.recipientEmail ?? "—"}</td>
                    <td className="py-3 pr-4 max-w-xs truncate">{item.subject ?? "—"}</td>
                    <td className="py-3 pr-4">
                      {(() => {
                        const badge = notificationStatusBadge(item.status);
                        return <StatusBadge status={badge.status} label={badge.label} />;
                      })()}
                      {item.errorMessage ? (
                        <p className="mt-1 max-w-xs text-xs text-destructive">
                          {item.errorMessage}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-col gap-2">
                        {item.jobId ? (
                          <Link href={`/admin/jobs/${item.jobId}`} className="underline">
                            Open job
                          </Link>
                        ) : null}
                        {item.quoteId ? (
                          <Link href={`/admin/quotes/${item.quoteId}`} className="underline">
                            Open quote
                          </Link>
                        ) : null}
                        {item.quoteRequestId ? (
                          <Link
                            href={`/admin/quote-requests/${item.quoteRequestId}`}
                            className="underline"
                          >
                            Open quote request
                          </Link>
                        ) : null}
                        {canRetry && item.status === "failed" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyId === item.id}
                            onClick={() => void retryNotification(item.id)}
                          >
                            {busyId === item.id ? "Retrying…" : "Retry"}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
