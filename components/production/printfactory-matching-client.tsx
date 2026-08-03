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
import type { ExceptionQueueTab } from "@/lib/printfactory/matching-queue";
import type { PrintfactoryDataQueryError } from "@/lib/printfactory/schema-readiness";

type MatchingRecord = {
  id: string;
  printfactory_job_guid: string;
  job_name: string | null;
  source_file_name: string | null;
  source_file_path: string | null;
  document_name?: string | null;
  device: string | null;
  media_type: string | null;
  printfactory_status: string | null;
  first_seen_at: string;
  job_match_status: string;
  job_match_confidence: number | null;
  extracted_job_reference: string | null;
  suggested_candid_job_id?: string | null;
  match_suggestion_reason?: string | null;
  match_suggestion_details?: {
    confidenceLevel?: string;
    jobReference?: string;
    projectName?: string;
    reasons?: string[];
  } | null;
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
    match_method?: string | null;
    suggestion_reason?: string | null;
    suggestion_details?: { reasons?: string[] } | null;
    production_items?: {
      id: string;
      item_reference: string | null;
      item_name: string;
    } | null;
  }>;
};

type PrintfactoryMatchingClientProps = {
  initialTab: ExceptionQueueTab;
  records: MatchingRecord[];
  tabCounts: Record<ExceptionQueueTab, number> | null;
  schemaMissing: boolean;
  schemaMissingMessage?: string | null;
  dataQueryError?: PrintfactoryDataQueryError | null;
  jobFilter?: string;
  connectionStatus: PrintfactoryConnectionStatus;
  tabLabels: Record<ExceptionQueueTab, string>;
};

export function PrintfactoryMatchingClient({
  initialTab,
  records,
  tabCounts,
  schemaMissing,
  schemaMissingMessage,
  dataQueryError,
  jobFilter,
  connectionStatus,
  tabLabels,
}: PrintfactoryMatchingClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ExceptionQueueTab>(initialTab);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const connection = connectionStatus;

  const filteredRecords = useMemo(() => {
    if (!jobFilter) {
      return records;
    }

    const term = jobFilter.toLowerCase();

    return records.filter((record) => {
      const jobRef = record.jobs?.job_reference?.toLowerCase() ?? "";
      const extracted = record.extracted_job_reference?.toLowerCase() ?? "";
      const suggestedRef =
        record.match_suggestion_details?.jobReference?.toLowerCase() ?? "";
      return (
        jobRef.includes(term) ||
        extracted.includes(term) ||
        suggestedRef.includes(term)
      );
    });
  }, [records, jobFilter]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

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
        summaryMessage?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Sync failed.");
      }

      setSyncMessage(payload.summaryMessage ?? "Sync completed.");
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

  async function runBulkAction(
    action: string,
    extra: Record<string, unknown> = {}
  ) {
    if (
      !window.confirm(
        "Apply this bulk action to the selected PrintFactory records?"
      )
    ) {
      return;
    }

    setActionError("");
    setBusyId("bulk");

    try {
      const response = await fetch("/api/admin/printfactory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          confirm: true,
          printfactoryJobIds: [...selectedIds],
          ...extra,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Bulk action failed.");
      }

      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Bulk action failed."
      );
    } finally {
      setBusyId(null);
    }
  }

  if (schemaMissing) {
    return (
      <Card className="portal-surface border-amber-300">
        <CardContent className="py-8 text-sm text-muted-foreground">
          {schemaMissingMessage ??
            "PrintFactory matching unavailable: required schema objects are missing."}
        </CardContent>
      </Card>
    );
  }

  if (dataQueryError) {
    return (
      <Card className="portal-surface border-destructive/30">
        <CardContent className="space-y-2 py-8 text-sm">
          <p className="font-medium text-foreground">
            PrintFactory matching data could not be loaded.
          </p>
          <p className="text-muted-foreground">{dataQueryError.message}</p>
          {process.env.NODE_ENV === "development" ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
              <p>code: {dataQueryError.code ?? "—"}</p>
              {dataQueryError.details ? <p>details: {dataQueryError.details}</p> : null}
              {dataQueryError.hint ? <p>hint: {dataQueryError.hint}</p> : null}
            </div>
          ) : null}
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
        {(Object.keys(tabLabels) as ExceptionQueueTab[]).map((value) => (
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
            {tabLabels[value]}
            {tabCounts ? ` (${tabCounts[value]})` : ""}
          </Button>
        ))}
      </div>

      {selectedIds.size > 0 ? (
        <Card className="portal-surface">
          <CardContent className="flex flex-wrap items-center gap-2 pt-6">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyId === "bulk"}
              onClick={() => void runBulkAction("rematch")}
            >
              Re-run matching
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyId === "bulk"}
              onClick={() => void runBulkAction("ignore_historical")}
            >
              Ignore as historical
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyId === "bulk"}
              onClick={() => void runBulkAction("clear_automatic_matches")}
            >
              Clear automatic matches
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === "suggested_matches" ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busyId === "bulk"}
            onClick={() =>
              void runBulkAction("confirm_high_confidence_suggestions")
            }
          >
            Confirm all high-confidence suggestions
          </Button>
        </div>
      ) : null}

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
            selected={selectedIds.has(record.id)}
            onToggleSelected={() => toggleSelected(record.id)}
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
  selected,
  onToggleSelected,
  onAction,
}: {
  record: MatchingRecord;
  tab: ExceptionQueueTab;
  busy: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onAction: (body: Record<string, unknown>) => void;
}) {
  const [candidJobId, setCandidJobId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");

  const suggestions = (record.printfactory_job_manifest_items ?? []).filter(
    (link) => link.link_status === "suggested"
  );

  const suggestionDetails = record.match_suggestion_details;
  const hasJobSuggestion =
    record.job_match_status === "suggested" && record.suggested_candid_job_id;

  return (
    <Card className="portal-surface">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {record.job_name ?? record.source_file_name ?? "Unnamed PrintFactory job"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Status: {record.job_match_status.replace(/_/g, " ")}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="h-4 w-4 rounded border-border"
          />
          Select
        </label>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">GUID:</span>{" "}
            {record.printfactory_job_guid}
          </p>
          <p>
            <span className="font-medium text-foreground">Filename:</span>{" "}
            {record.source_file_name ?? record.document_name ?? "—"}
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
            <span className="font-medium text-foreground">PrintFactory status:</span>{" "}
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
          {hasJobSuggestion ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm">
              <p className="font-medium text-foreground">Suggested job</p>
              <p>
                {suggestionDetails?.jobReference ?? "—"} —{" "}
                {suggestionDetails?.projectName ?? "Unknown project"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Confidence:{" "}
                {suggestionDetails?.confidenceLevel ?? "medium"}
              </p>
              <p className="mt-1 text-xs">
                Reason: {record.match_suggestion_reason ?? "Title similarity"}
              </p>
              {(suggestionDetails?.reasons ?? []).length > 1 ? (
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {(suggestionDetails?.reasons ?? []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAction({ action: "confirm_suggested_job" })}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onAction({ action: "rematch" })}
                >
                  Choose another
                </Button>
              </div>
            </div>
          ) : null}

          {(tab === "needs_attention" || tab === "all_imported") &&
          !record.jobs &&
          !hasJobSuggestion ? (
            <div className="space-y-2">
              <Label htmlFor={`job-${record.id}`}>Match to Candid job ID</Label>
              <Input
                id={`job-${record.id}`}
                value={candidJobId}
                onChange={(event) => setCandidJobId(event.target.value)}
                placeholder="Job UUID"
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

          {record.job_match_status === "matched_automatically" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction({ action: "clear_auto_match" })}
            >
              Clear automatic match
            </Button>
          ) : null}

          {suggestions.length > 0 ? (
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
                    Confidence:{" "}
                    {(link.match_confidence ?? 0) >= 0.85
                      ? "High"
                      : (link.match_confidence ?? 0) >= 0.6
                        ? "Medium"
                        : "Low"}
                  </p>
                  {link.suggestion_reason ? (
                    <p className="text-xs text-muted-foreground">
                      Reason: {link.suggestion_reason}
                    </p>
                  ) : null}
                  {(link.suggestion_details?.reasons ?? []).map((reason) => (
                    <p key={reason} className="text-xs text-muted-foreground">
                      · {reason}
                    </p>
                  ))}
                  {tab !== "confirmed" ? (
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
                      {link.match_method === "exact_item_reference"
                        ? "One-click confirm"
                        : "Confirm suggested item"}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {record.jobs && suggestions.length === 0 && tab === "needs_attention" ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Unrecognised file for known job {record.jobs.job_reference}. Link to
              an existing item or create an additional production item.
            </p>
          ) : null}

          {record.jobs && tab !== "confirmed" ? (
            <div className="space-y-2">
              <Label htmlFor={`item-${record.id}`}>Link to manifest item ID</Label>
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

          {record.jobs && tab !== "confirmed" && tab !== "ignored" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Create additional production item
              </p>
              <Select defaultValue="additional_billable" id={`classification-${record.id}`}>
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

          {tab !== "ignored" ? (
            <div className="space-y-2">
              <Label htmlFor={`ignore-${record.id}`}>Ignore reason</Label>
              <Textarea
                id={`ignore-${record.id}`}
                value={ignoreReason}
                onChange={(event) => setIgnoreReason(event.target.value)}
                rows={2}
                placeholder="Historical import, test job, etc."
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
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
