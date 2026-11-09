"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SyncStatus = {
  integrationEnabled: boolean;
  providerMode: "mock" | "google" | "disabled";
  providerLabel: string;
  mockDeliveryOnly: boolean;
  teamCalendarConfigured: boolean;
  sicknessCalendarConfigured: boolean;
  outboxCounts: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    discarded: number;
    mockSent: number;
    googleSent: number;
  };
  mappingCounts: {
    active: number;
    deleted: number;
    mockActive: number;
    googleActive: number;
  };
  lastSuccessfulProcessedAt: string | null;
  recentErrors: Array<{ id: string; lastError: string | null; processedAt: string | null }>;
  deliveryGateReason: string | null;
};

type ReconcilePayload = {
  ok: boolean;
  scan?: {
    findings: Array<{ kind: string; entityId: string; detail?: string }>;
    summary: Record<string, number>;
  };
  enqueue?: { dryRun: boolean; enqueued: number; skipped: number };
  error?: string;
};

export function AdminCalendarSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/leave/calendar-sync/status", {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: SyncStatus;
      error?: string;
    };

    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not load calendar sync status.");
      return;
    }

    setStatus(payload.status ?? null);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function runReconciliation(dryRun: boolean) {
    setReconcileBusy(true);
    setReconcileReport(null);
    setError(null);

    const response = await fetch("/api/admin/leave/calendar-sync/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun,
        enqueue: !dryRun,
        includeGoogleRefresh: true,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as ReconcilePayload;
    setReconcileBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Reconciliation failed.");
      return;
    }

    const findingCount = payload.scan?.findings.length ?? 0;
    const enqueued = payload.enqueue?.enqueued ?? 0;

    if (dryRun) {
      setReconcileReport(
        `Scan only: ${findingCount} finding(s). Nothing enqueued. Historical leave is not backfilled automatically.`
      );
    } else {
      setReconcileReport(
        `Reconciliation enqueued ${enqueued} repair job(s) from ${findingCount} finding(s). Future approved leave only.`
      );
    }

    await loadStatus();
  }

  const counts = status?.outboxCounts;

  return (
    <Card className="portal-surface rounded-2xl shadow-sm ring-0">
      <CardHeader className="border-b border-border">
        <CardTitle>Calendar sync status</CardTitle>
        <CardDescription>
          Team holiday and management sickness calendars (Google integration disabled until
          approved). Mock deliveries are never sent to Google.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading calendar sync status…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : status ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <p>
                <span className="text-muted-foreground">Integration:</span>{" "}
                {status.integrationEnabled ? "Enabled" : "Disabled"}
              </p>
              <p>
                <span className="text-muted-foreground">Provider:</span> {status.providerLabel}
              </p>
              <p>
                <span className="text-muted-foreground">Mode:</span>{" "}
                {status.providerMode === "mock"
                  ? "Mock (simulated)"
                  : status.providerMode === "google"
                    ? "Google"
                    : "Disabled"}
              </p>
              <p>
                <span className="text-muted-foreground">Last success:</span>{" "}
                {status.lastSuccessfulProcessedAt ?? "—"}
              </p>
            </div>

            {status.mockDeliveryOnly ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Mock delivery is active.{" "}
                <strong>{counts?.mockSent ?? 0}</strong> outbox row(s) and{" "}
                <strong>{status.mappingCounts.mockActive}</strong> mapping(s) are mock-only until
                Google is enabled.
              </p>
            ) : null}

            {status.deliveryGateReason ? (
              <p className="text-sm text-muted-foreground">Gate: {status.deliveryGateReason}</p>
            ) : null}

            {counts ? (
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
                <p>Pending: {counts.pending}</p>
                <p>Processing: {counts.processing}</p>
                <p>Sent: {counts.sent}</p>
                <p>Failed: {counts.failed}</p>
                <p>Discarded: {counts.discarded}</p>
                <p>Mock sent: {counts.mockSent}</p>
              </div>
            ) : null}

            {status.recentErrors.length > 0 ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">Recent errors</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {status.recentErrors.map((row) => (
                    <li key={row.id}>
                      {row.lastError ?? "unknown"} ({row.processedAt ?? "—"})
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No recent calendar sync failures.</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={reconcileBusy}
                onClick={() => void runReconciliation(true)}
              >
                Scan (dry run)
              </Button>
              <Button
                type="button"
                disabled={reconcileBusy}
                onClick={() => void runReconciliation(false)}
              >
                Run reconciliation
              </Button>
              <Button type="button" variant="ghost" disabled={loading} onClick={() => void loadStatus()}>
                Refresh
              </Button>
            </div>

            {reconcileReport ? <p className="text-sm text-muted-foreground">{reconcileReport}</p> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
