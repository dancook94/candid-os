"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { PrintfactoryConnectionStatus } from "@/lib/printfactory/client";

type MatchingTab =
  | "needs_job_match"
  | "needs_item_match"
  | "confirmed"
  | "ignored";

type MatchingRecord = {
  id: string;
  printfactory_job_guid: string;
  job_name: string | null;
  source_file_name: string | null;
  source_file_path: string | null;
  device: string | null;
  media_type: string | null;
  printfactory_status: string | null;
  first_seen_at: string;
  job_match_status: string;
  job_match_confidence: number | null;
  extracted_job_reference: string | null;
  jobs?: {
    id: string;
    job_reference: string;
    project_name: string;
    companies?: { company_name: string | null } | null;
  } | null;
  printfactory_job_manifest_items?: Array<{
    id: string;
    link_status: string;
    match_confidence: number | null;
    production_items?: {
      id: string;
      item_reference: string | null;
      item_name: string;
    } | null;
  }>;
};

type PrintfactoryMatchingClientProps = {
  initialTab: MatchingTab;
  records: MatchingRecord[];
  schemaMissing: boolean;
  jobFilter?: string;
  connectionStatus: PrintfactoryConnectionStatus;
};

const TAB_LABELS: Record<MatchingTab, string> = {
  needs_job_match: "Needs job match",
  needs_item_match: "Needs item match",
  confirmed: "Confirmed",
  ignored: "Ignored",
};

export function PrintfactoryMatchingClient({
  initialTab,
  records,
  schemaMissing,
  jobFilter,
  connectionStatus,
}: PrintfactoryMatchingClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<MatchingTab>(initialTab);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [actionError, setActionError] = useState("");
  const connection = connectionStatus;

  const filteredRecords = useMemo(() => {
    if (!jobFilter) {
      return records;
    }

    const term = jobFilter.toLowerCase();

    return records.filter((record) => {
      const jobRef = record.jobs?.job_reference?.toLowerCase() ?? "";
      const extracted = record.extracted_job_reference?.toLowerCase() ?? "";
      return jobRef.includes(term) || extracted.includes(term);
    });
  }, [records, jobFilter]);

  async function runSync() {
    setSyncError("");
    setSyncMessage("");
    setBusyId("sync");

    try {
      const response = await fetch("/api/admin/printfactory/sync", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        imported?: number;
        updated?: number;
        matched?: number;
        unmatched?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Sync failed.");
      }

      setSyncMessage(
        `Synced: ${payload.imported ?? 0} imported, ${payload.updated ?? 0} updated, ${payload.matched ?? 0} matched, ${payload.unmatched ?? 0} unmatched.`
      );
      router.refresh();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(
    recordId: string,
    body: Record<string, unknown>
  ) {
    setActionError("");
    setBusyId(recordId);

    try {
      const response = await fetch(`/api/admin/printfactory/jobs/${recordId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Action failed.");
      }

      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (schemaMissing) {
    return (
      <Card className="portal-surface border-amber-300">
        <CardContent className="py-8 text-sm text-muted-foreground">
          Apply{" "}
          <code className="text-xs">
            supabase/migrations/20260803220000_printfactory_production_board_phase2.sql
          </code>{" "}
          before using PrintFactory matching.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="portal-surface">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">PrintFactory connection</p>
            {connection.configured ? (
              <p className="text-muted-foreground">
                API configured at {connection.baseUrl}
              </p>
            ) : (
              <p className="text-destructive">
                Missing configuration: {connection.missing.join(", ")}
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={() => void runSync()}
            disabled={busyId === "sync" || !connection.configured}
          >
            {busyId === "sync" ? "Syncing…" : "Sync PrintFactory"}
          </Button>
        </CardContent>
      </Card>

      {syncMessage ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {syncMessage}
        </p>
      ) : null}
      {syncError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {syncError}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as MatchingTab[]).map((value) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTab(value);
              router.push(`/admin/production/printfactory-unmatched?tab=${value}`);
            }}
          >
            {TAB_LABELS[value]}
          </Button>
        ))}
      </div>

      {filteredRecords.length === 0 ? (
        <Card className="portal-surface">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No PrintFactory records in this tab.
          </CardContent>
        </Card>
      ) : (
        filteredRecords.map((record) => (
          <PrintfactoryRecordCard
            key={record.id}
            record={record}
            tab={tab}
            busy={busyId === record.id}
            onAction={(body) => void runAction(record.id, body)}
          />
        ))
      )}
    </div>
  );
}

function PrintfactoryRecordCard({
  record,
  tab,
  busy,
  onAction,
}: {
  record: MatchingRecord;
  tab: MatchingTab;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => void;
}) {
  const [candidJobId, setCandidJobId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");

  const suggestions = (record.printfactory_job_manifest_items ?? []).filter(
    (link) => link.link_status === "suggested"
  );

  return (
    <Card className="portal-surface">
      <CardHeader>
        <CardTitle className="text-base">
          {record.job_name ?? record.source_file_name ?? "Unnamed PrintFactory job"}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">GUID:</span>{" "}
            {record.printfactory_job_guid}
          </p>
          <p>
            <span className="font-medium text-foreground">Filename:</span>{" "}
            {record.source_file_name ?? "—"}
          </p>
          <p className="break-all">
            <span className="font-medium text-foreground">Source path:</span>{" "}
            {record.source_file_path ?? "—"}
          </p>
          <p>
            <span className="font-medium text-foreground">Device:</span>{" "}
            {record.device ?? "—"} · {record.media_type ?? "—"}
          </p>
          <p>
            <span className="font-medium text-foreground">Status:</span>{" "}
            {record.printfactory_status ?? "—"}
          </p>
          <p>
            <span className="font-medium text-foreground">Imported:</span>{" "}
            {formatCrmDateTime(record.first_seen_at)}
          </p>
          {record.jobs ? (
            <p>
              <span className="font-medium text-foreground">Candid job:</span>{" "}
              {record.jobs.job_reference} · {record.jobs.project_name}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {tab === "needs_job_match" ? (
            <div className="space-y-2">
              <Label htmlFor={`job-${record.id}`}>Match to Candid job ID</Label>
              <Input
                id={`job-${record.id}`}
                value={candidJobId}
                onChange={(event) => setCandidJobId(event.target.value)}
                placeholder="Job UUID or use extracted ref lookup"
              />
              {record.extracted_job_reference ? (
                <p className="text-xs text-muted-foreground">
                  Extracted reference: {record.extracted_job_reference}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={busy || !candidJobId.trim()}
                onClick={() =>
                  onAction({
                    action: "match_job",
                    candidJobId: candidJobId.trim(),
                  })
                }
              >
                Match to Candid job
              </Button>
            </div>
          ) : null}

          {(tab === "needs_item_match" || tab === "confirmed") &&
          suggestions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Suggested manifest items
              </p>
              {suggestions.map((link) => (
                <div
                  key={link.id}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p>
                    {link.production_items?.item_reference ?? "—"} ·{" "}
                    {link.production_items?.item_name ?? "Unknown item"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Confidence: {link.match_confidence ?? "—"}
                  </p>
                  {tab === "needs_item_match" ? (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      disabled={busy}
                      onClick={() =>
                        onAction({
                          action: "confirm_item",
                          productionItemId: link.production_items?.id,
                        })
                      }
                    >
                      Confirm suggested item
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {tab === "needs_item_match" && record.jobs ? (
            <div className="space-y-2">
              <Label htmlFor={`item-${record.id}`}>Select different item ID</Label>
              <Input
                id={`item-${record.id}`}
                value={selectedItemId}
                onChange={(event) => setSelectedItemId(event.target.value)}
                placeholder="Production item UUID"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !selectedItemId.trim()}
                onClick={() =>
                  onAction({
                    action: "confirm_item",
                    productionItemId: selectedItemId.trim(),
                  })
                }
              >
                Link to item
              </Button>
            </div>
          ) : null}

          {tab === "needs_item_match" && record.jobs ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Create additional production item
              </p>
              <Select
                defaultValue="additional_billable"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "ignore") {
                    return;
                  }
                }}
                id={`classification-${record.id}`}
              >
                <option value="additional_billable">Additional billable item</option>
                <option value="replacement">Replacement</option>
                <option value="no_charge_reprint">No-charge reprint</option>
                <option value="internal_test">Internal/test</option>
              </Select>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  onAction({
                    action: "create_additional_item",
                    classification: "additional_billable",
                    title: record.job_name ?? record.source_file_name,
                    material: record.media_type,
                    machine: record.device,
                  })
                }
              >
                Create additional production item
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`ignore-${record.id}`}>Ignore reason</Label>
            <Textarea
              id={`ignore-${record.id}`}
              value={ignoreReason}
              onChange={(event) => setIgnoreReason(event.target.value)}
              rows={2}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !ignoreReason.trim()}
              onClick={() =>
                onAction({
                  action: "ignore",
                  reason: ignoreReason.trim(),
                })
              }
            >
              Ignore
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
