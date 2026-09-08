"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { JobBillingType } from "@/lib/jobs/billing-types";
import { JOB_BILLING_TYPE_LABELS } from "@/lib/jobs/billing-types";
import { PrintfactoryThumbnailStrip } from "@/components/production/printfactory-thumbnail-strip";
import type { PrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import type { ExceptionQueueTab } from "@/lib/printfactory/matching-queue";
import { resolveDisplayOutputPageCount } from "@/lib/printfactory/output-page-count";
import { isPrintFactoryJobRipped } from "@/lib/printfactory/ripped";
import type { PrintfactoryDataQueryError } from "@/lib/printfactory/schema-readiness";
import {
  formatLiveSyncHealthLabel,
  type PrintfactorySyncHealth,
} from "@/lib/printfactory/sync-health";

type SyncResponsePayload = {
  ok?: boolean;
  partial?: boolean;
  syncMode?: "live";
  error?: string;
  safeMessage?: string;
  failingStage?: string | null;
  errorCode?: string | null;
  summaryMessage?: string;
  recordsReceived?: number;
  imported?: number;
  refreshed?: number;
  updated?: number;
  windowCapped?: boolean;
  hasMore?: boolean;
  skipCursor?: number;
  nextCursor?: number | null;
};

function formatSyncFailureMessage(payload: SyncResponsePayload): string {
  const parts: string[] = [];
  const detail = payload.safeMessage ?? payload.error;

  if (detail?.trim()) {
    parts.push(detail.trim());
  }

  if (payload.failingStage) {
    parts.push(`Stage: ${payload.failingStage.replace(/_/g, " ")}`);
  }

  if (payload.errorCode && payload.errorCode !== "sync_failed") {
    parts.push(`Code: ${payload.errorCode}`);
  }

  if (
    typeof payload.recordsReceived === "number" &&
    payload.recordsReceived > 0
  ) {
    parts.push(`Records received: ${payload.recordsReceived}`);
  }

  if (typeof payload.imported === "number" && payload.imported > 0) {
    parts.push(`Imported before failure: ${payload.imported}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Sync failed.";
}

async function parseSyncResponse(response: Response): Promise<SyncResponsePayload> {
  const rawText = await response.text();

  if (!rawText.trim()) {
    throw new Error(
      `Sync failed (${response.status}): server returned an empty response body.`
    );
  }

  try {
    return JSON.parse(rawText) as SyncResponsePayload;
  } catch {
    throw new Error(
      `Sync failed (${response.status}): server returned a non-JSON response.`
    );
  }
}

type CompanyOption = {
  id: string;
  companyName: string;
};

type JobSearchResult = {
  id: string;
  jobReference: string;
  projectName: string;
  companyName: string;
  billingType: JobBillingType | null;
};

type MatchingRecord = {
  id: string;
  printfactory_job_guid: string;
  job_name: string | null;
  source_file_name: string | null;
  source_file_path: string | null;
  normalized_source_path?: string | null;
  source_path_status?: string | null;
  source_locations?: Array<{
    documentGuid?: string | null;
    documentName?: string | null;
    rawLocation?: string;
    normalizedLocation?: string;
    extractedJobReferences?: string[];
  }> | null;
  document_name?: string | null;
  device: string | null;
  media_type: string | null;
  printfactory_status: string | null;
  progress: number | null;
  created_at_printfactory?: string | null;
  first_seen_at: string;
  job_match_status: string;
  job_match_method?: string | null;
  job_match_confidence: number | null;
  ignored_at?: string | null;
  ignore_reason?: string | null;
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
  is_multi_job_sheet?: boolean | null;
  raw_metadata?: Record<string, unknown> | null;
  printfactory_job_candid_jobs?: Array<{
    id: string;
    candid_job_id: string;
    link_type: string;
    is_primary: boolean;
    jobs?: {
      id: string;
      job_reference: string;
      project_name: string;
      companies?: { company_name: string | null } | null;
    } | null;
  }>;
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

type LinkedCandidJobView = {
  id: string;
  jobReference: string;
  projectName: string;
  companyName: string | null;
};

function resolveLinkedCandidJobs(record: MatchingRecord): LinkedCandidJobView[] {
  const fromJunction = (record.printfactory_job_candid_jobs ?? [])
    .map((link) => link.jobs)
    .filter(Boolean)
    .map((job) => ({
      id: job!.id,
      jobReference: job!.job_reference,
      projectName: job!.project_name,
      companyName: job!.companies?.company_name ?? null,
    }));

  if (fromJunction.length > 0) {
    const seen = new Set<string>();
    return fromJunction.filter((job) => {
      if (seen.has(job.id)) {
        return false;
      }
      seen.add(job.id);
      return true;
    });
  }

  if (record.jobs) {
    return [
      {
        id: record.jobs.id,
        jobReference: record.jobs.job_reference,
        projectName: record.jobs.project_name,
        companyName: record.jobs.companies?.company_name ?? null,
      },
    ];
  }

  return [];
}

function PendingJobSelectionChips({
  selectedJobs,
  onRemove,
  onClearAll,
}: {
  selectedJobs: JobSearchResult[];
  onRemove: (jobId: string) => void;
  onClearAll: () => void;
}) {
  if (selectedJobs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-foreground">Selected jobs:</p>
        <span className="text-xs text-muted-foreground">
          {selectedJobs.length} selected
        </span>
        {selectedJobs.length > 1 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {selectedJobs.map((job) => (
          <span
            key={job.id}
            className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-muted/50 py-0.5 pl-2.5 pr-0.5 text-xs"
          >
            <span className="min-w-0 truncate py-1">
              <span className="font-semibold text-foreground">{job.jobReference}</span>
              {job.projectName ? (
                <span className="text-muted-foreground"> · {job.projectName}</span>
              ) : null}
            </span>
            <button
              type="button"
              aria-label={`Remove ${job.jobReference} from selection`}
              onClick={() => onRemove(job.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

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
  goLiveDate: string;
  includeHistorical: boolean;
  dateFrom?: string;
  dateTo?: string;
  allRecordsCount: number;
  operationalRecordsCount: number;
  companies: CompanyOption[];
  syncHealth: PrintfactorySyncHealth;
};

function buildMatchingHref(options: {
  tab: ExceptionQueueTab;
  includeHistorical: boolean;
  dateFrom?: string;
  dateTo?: string;
  job?: string;
}) {
  const params = new URLSearchParams();
  params.set("tab", options.tab);

  if (options.includeHistorical) {
    params.set("historical", "1");
  }

  if (options.dateFrom) {
    params.set("from", options.dateFrom);
  }

  if (options.dateTo) {
    params.set("to", options.dateTo);
  }

  if (options.job) {
    params.set("job", options.job);
  }

  return `/admin/production/printfactory-unmatched?${params.toString()}`;
}

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
  goLiveDate,
  includeHistorical,
  dateFrom,
  dateTo,
  allRecordsCount,
  operationalRecordsCount,
  companies,
  syncHealth,
}: PrintfactoryMatchingClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ExceptionQueueTab>(initialTab);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterHistorical, setFilterHistorical] = useState(includeHistorical);
  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom ?? "");
  const [filterDateTo, setFilterDateTo] = useState(dateTo ?? "");
  const connection = connectionStatus;

  const filteredRecords = useMemo(() => {
    if (!jobFilter) {
      return records;
    }

    const term = jobFilter.toLowerCase();

    return records.filter((record) => {
      const linked = resolveLinkedCandidJobs(record);
      const jobRef = record.jobs?.job_reference?.toLowerCase() ?? "";
      const linkedRefs = linked.map((job) => job.jobReference.toLowerCase()).join(" ");
      const extracted = record.extracted_job_reference?.toLowerCase() ?? "";
      const suggestedRef =
        record.match_suggestion_details?.jobReference?.toLowerCase() ?? "";
      return (
        jobRef.includes(term) ||
        linkedRefs.includes(term) ||
        extracted.includes(term) ||
        suggestedRef.includes(term)
      );
    });
  }, [records, jobFilter]);

  function applyFilters(nextTab = tab) {
    router.push(
      buildMatchingHref({
        tab: nextTab,
        includeHistorical: filterHistorical,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        job: jobFilter,
      })
    );
  }

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await parseSyncResponse(response);

      if (!response.ok && !payload.partial) {
        throw new Error(formatSyncFailureMessage(payload));
      }

      if (!payload.ok && payload.error && !payload.partial) {
        throw new Error(formatSyncFailureMessage(payload));
      }

      if (payload.partial && payload.error) {
        setSyncError(formatSyncFailureMessage(payload));
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
    body: Record<string, unknown>,
    redirectTo?: string
  ) {
    setActionError("");
    setBusyId(recordId);

    try {
      const response = await fetch(`/api/admin/printfactory/jobs/${recordId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        redirectPath?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Action failed.");
      }

      if (redirectTo || payload.redirectPath) {
        router.push(redirectTo ?? payload.redirectPath ?? "/admin/production");
        return;
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
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="portal-surface">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
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
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void runSync()}
                disabled={busyId === "sync" || !connection.configured}
              >
                {busyId === "sync" ? "Syncing…" : "Sync PrintFactory"}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
            <p
              className={
                syncHealth.liveDelayed || syncHealth.liveLastError
                  ? "font-medium text-amber-900"
                  : "font-medium text-emerald-800"
              }
            >
              PrintFactory · {formatLiveSyncHealthLabel(syncHealth)}
            </p>
            {syncHealth.liveWindowCapped ? (
              <p className="text-amber-900">
                Live window was capped on the last run — recent jobs may remain queued until
                the window is fully processed.
              </p>
            ) : null}
            {syncHealth.syncLocked ? (
              <p className="text-muted-foreground">
                Sync lock active ({syncHealth.syncLockMode ?? "live"}).
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            Operational queue from <strong>{goLiveDate}</strong>:{" "}
            {operationalRecordsCount} record{operationalRecordsCount === 1 ? "" : "s"}
            {allRecordsCount !== operationalRecordsCount
              ? ` (${allRecordsCount} total imported)`
              : ""}
            . Configure with{" "}
            <code className="text-xs">PRINTFACTORY_MATCHING_GO_LIVE_DATE</code>.
          </div>
        </CardContent>
      </Card>

      <Card className="portal-surface">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="pf-date-from">Date from</Label>
            <Input
              id="pf-date-from"
              type="date"
              value={filterDateFrom}
              onChange={(event) => setFilterDateFrom(event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="pf-date-to">Date to</Label>
            <Input
              id="pf-date-to"
              type="date"
              value={filterDateTo}
              onChange={(event) => setFilterDateTo(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3 md:col-span-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={filterHistorical}
                onChange={(event) => setFilterHistorical(event.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Include historical (before {goLiveDate})
            </label>
            <Button type="button" size="sm" variant="outline" onClick={() => applyFilters()}>
              Apply filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {syncMessage ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {syncMessage}
        </pre>
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
              router.push(
                buildMatchingHref({
                  tab: value,
                  includeHistorical: filterHistorical,
                  dateFrom: filterDateFrom || undefined,
                  dateTo: filterDateTo || undefined,
                  job: jobFilter,
                })
              );
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
          </CardContent>
        </Card>
      ) : null}

      {filteredRecords.length === 0 ? (
        <Card className="portal-surface">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No PrintFactory records in this view.
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
            companies={companies}
            onToggleSelected={() => toggleSelected(record.id)}
            onAction={(body, redirectTo) => void runAction(record.id, body, redirectTo)}
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
  companies,
  onToggleSelected,
  onAction,
}: {
  record: MatchingRecord;
  tab: ExceptionQueueTab;
  busy: boolean;
  selected: boolean;
  companies: CompanyOption[];
  onToggleSelected: () => void;
  onAction: (body: Record<string, unknown>, redirectTo?: string) => void;
}) {
  const [activeAction, setActiveAction] = useState<"assign" | "create" | "add_job" | null>(null);
  const [jobSearch, setJobSearch] = useState("");
  const [jobResults, setJobResults] = useState<JobSearchResult[]>([]);
  const [searchingJobs, setSearchingJobs] = useState(false);
  const [selectedJobsById, setSelectedJobsById] = useState<Record<string, JobSearchResult>>({});
  const [ignoreReason, setIgnoreReason] = useState("");
  const [billingType, setBillingType] = useState<JobBillingType>("billable");
  const [projectName, setProjectName] = useState(
    record.job_name ?? record.document_name ?? record.source_file_name ?? ""
  );
  const [companyId, setCompanyId] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [createNotes, setCreateNotes] = useState("");

  const suggestions = (record.printfactory_job_manifest_items ?? []).filter(
    (link) => link.link_status === "suggested"
  );
  const suggestionDetails = record.match_suggestion_details;
  const hasJobSuggestion =
    record.job_match_status === "suggested" && record.suggested_candid_job_id;
  const sourceLocations = record.source_locations ?? [];
  const sourcePathUnavailable =
    record.source_path_status === "error" ||
    record.source_path_status === "unavailable" ||
    record.source_path_status === "missing";
  const linkedJobs = resolveLinkedCandidJobs(record);
  const linkedJobIds = new Set(linkedJobs.map((job) => job.id));
  const isSharedPrint = linkedJobs.length > 1 || Boolean(record.is_multi_job_sheet);
  const canTakeMatchingActions =
    tab === "needs_attention" &&
    linkedJobs.length === 0 &&
    record.job_match_status !== "ignored";
  const canManageLinkedJobs =
    linkedJobs.length > 0 &&
    record.job_match_status !== "ignored" &&
    tab !== "ignored";

  const pendingSelectedJobs = Object.values(selectedJobsById);

  function removePendingSelectedJob(jobId: string) {
    setSelectedJobsById((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
  }

  function clearPendingSelectedJobs() {
    setSelectedJobsById({});
  }

  function togglePendingSelectedJob(job: JobSearchResult) {
    if (linkedJobIds.has(job.id)) {
      return;
    }

    setSelectedJobsById((current) => {
      if (current[job.id]) {
        const next = { ...current };
        delete next[job.id];
        return next;
      }

      return {
        ...current,
        [job.id]: job,
      };
    });
  }

  const isRipped = isPrintFactoryJobRipped(record, { allowIgnored: true });
  const outputPageCount = isRipped
    ? resolveDisplayOutputPageCount(record.raw_metadata, 1)
    : 0;
  const previewAlt =
    record.job_name ??
    record.source_file_name ??
    record.document_name ??
    "PrintFactory preview";

  useEffect(() => {
    if (
      (activeAction !== "assign" && activeAction !== "add_job") ||
      jobSearch.trim().length < 1
    ) {
      setJobResults([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchingJobs(true);

      try {
        const response = await fetch(
          `/api/admin/jobs/search?q=${encodeURIComponent(jobSearch.trim())}`,
          { signal: controller.signal }
        );
        const payload = (await response.json()) as {
          jobs?: JobSearchResult[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Job search failed.");
        }

        setJobResults(payload.jobs ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setJobResults([]);
        }
      } finally {
        setSearchingJobs(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [activeAction, jobSearch]);

  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 pb-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="break-words text-base">
              {record.job_name ?? record.source_file_name ?? "Unnamed PrintFactory job"}
            </CardTitle>
            {isSharedPrint ? (
              <span className="inline-flex shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-600/10">
                Shared print · {linkedJobs.length} jobs
              </span>
            ) : null}
          </div>
          <p className="break-words text-xs text-muted-foreground">
            Status: {record.job_match_status.replace(/_/g, " ")}
            {record.job_match_method ? ` · ${record.job_match_method}` : ""}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="h-4 w-4 rounded border-border"
          />
          Select
        </label>
      </CardHeader>
      <CardContent
        className={`grid items-start gap-6 pt-6 ${
          isRipped
            ? "lg:grid-cols-[minmax(0,1.5fr)_220px_minmax(280px,0.9fr)]"
            : "lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]"
        }`}
      >
        <div className="min-w-0 space-y-2 text-sm text-muted-foreground">
          <p className="break-words">
            <span className="font-medium text-foreground">Filename:</span>{" "}
            {record.source_file_name ?? record.document_name ?? "—"}
          </p>
          <p className="break-all">
            <span className="font-medium text-foreground">Source path:</span>{" "}
            {record.normalized_source_path ?? record.source_file_path ?? "—"}
          </p>
          {sourcePathUnavailable ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              Source path {record.source_path_status?.replace(/_/g, " ")}.
            </p>
          ) : null}
          {record.extracted_job_reference ? (
            <p className="break-words">
              <span className="font-medium text-foreground">Extracted reference:</span>{" "}
              {record.extracted_job_reference}
            </p>
          ) : null}
          <p className="break-words">
            <span className="font-medium text-foreground">Device / media:</span>{" "}
            {record.device ?? "—"} · {record.media_type ?? "—"}
          </p>
          <p>
            <span className="font-medium text-foreground">PrintFactory created:</span>{" "}
            {record.created_at_printfactory
              ? formatCrmDateTime(record.created_at_printfactory)
              : formatCrmDateTime(record.first_seen_at)}
          </p>
          {linkedJobs.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <p className="font-medium text-foreground">
                Linked to {linkedJobs.length} job{linkedJobs.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-2 space-y-2">
                {linkedJobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="break-words">
                      <a
                        href={`/admin/jobs/${job.id}`}
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {job.jobReference}
                      </a>{" "}
                      · {job.projectName}
                      {job.companyName ? ` · ${job.companyName}` : ""}
                    </span>
                    {canManageLinkedJobs ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Remove the link between this PrintFactory output and ${job.jobReference}?`
                            )
                          ) {
                            return;
                          }

                          onAction({
                            action: "remove_linked_job",
                            candidJobId: job.id,
                          });
                        }}
                      >
                        Remove link
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {isRipped ? (
          <div className="mx-auto w-[220px] max-w-full shrink-0 justify-self-center lg:mx-0 lg:justify-self-auto">
            <PrintfactoryThumbnailStrip
              jobGuid={record.printfactory_job_guid}
              outputPageCount={outputPageCount}
              alt={previewAlt}
              previewWidthClassName="w-[68px]"
              maxHeightClassName="h-16 max-h-16"
              showSheetCountLabel={outputPageCount > 1}
              showEnlargeHint
            />
          </div>
        ) : null}

        <div className="min-w-0 space-y-4">
          {hasJobSuggestion ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm">
              <p className="font-medium text-foreground">Suggested job</p>
              <p>
                {suggestionDetails?.jobReference ?? "—"} —{" "}
                {suggestionDetails?.projectName ?? "Unknown project"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAction({ action: "confirm_suggested_job" })}
                >
                  Confirm suggestion
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

          {canTakeMatchingActions ? (
            <div className="space-y-3 rounded-lg border border-border px-3 py-3">
              <p className="text-sm font-medium text-foreground">Actions</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={activeAction === "assign" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() =>
                    setActiveAction((current) => (current === "assign" ? null : "assign"))
                  }
                >
                  Assign to existing job
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={activeAction === "create" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() =>
                    setActiveAction((current) => (current === "create" ? null : "create"))
                  }
                >
                  Create job
                </Button>
              </div>

              {activeAction === "assign" ? (
                <div className="space-y-2">
                  <Label htmlFor={`search-${record.id}`}>
                    Search Candid jobs (select one or more)
                  </Label>
                  <Input
                    id={`search-${record.id}`}
                    value={jobSearch}
                    onChange={(event) => setJobSearch(event.target.value)}
                    placeholder="Job reference, project, or company"
                  />
                  <PendingJobSelectionChips
                    selectedJobs={pendingSelectedJobs}
                    onRemove={removePendingSelectedJob}
                    onClearAll={clearPendingSelectedJobs}
                  />
                  {searchingJobs ? (
                    <p className="text-xs text-muted-foreground">Searching…</p>
                  ) : null}
                  {jobResults.length > 0 ? (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border">
                      {jobResults.map((job) => {
                        const isSelected = Boolean(selectedJobsById[job.id]);
                        const alreadyLinked = linkedJobIds.has(job.id);

                        return (
                          <button
                            key={job.id}
                            type="button"
                            disabled={alreadyLinked}
                            className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                              isSelected ? "bg-muted/60" : ""
                            }`}
                            onClick={() => togglePendingSelectedJob(job)}
                          >
                            <span className="font-medium text-foreground">
                              {isSelected ? "✓ " : ""}
                              {job.jobReference}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {job.projectName} · {job.companyName}
                              {alreadyLinked
                                ? " · already linked"
                                : isSelected
                                  ? " · selected"
                                  : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || pendingSelectedJobs.length === 0}
                    onClick={() => {
                      onAction({
                        action: "match_job",
                        candidJobIds: pendingSelectedJobs.map((job) => job.id),
                      });
                      clearPendingSelectedJobs();
                    }}
                  >
                    Assign to {pendingSelectedJobs.length || 0} job
                    {pendingSelectedJobs.length === 1 ? "" : "s"}
                  </Button>
                </div>
              ) : null}

              {activeAction === "create" ? (
                <div className="space-y-2">
                  <Label htmlFor={`billing-${record.id}`}>Job type</Label>
                  <Select
                    id={`billing-${record.id}`}
                    value={billingType}
                    onChange={(event) =>
                      setBillingType(event.target.value as JobBillingType)
                    }
                  >
                    <option value="billable">Billable customer job</option>
                    <option value="non_billable">Non-billable / FOC customer job</option>
                    <option value="internal">Internal Candid job</option>
                  </Select>
                  <Label htmlFor={`project-${record.id}`}>Project name</Label>
                  <Input
                    id={`project-${record.id}`}
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                  {billingType !== "internal" ? (
                    <>
                      <Label htmlFor={`company-${record.id}`}>Company</Label>
                      <Select
                        id={`company-${record.id}`}
                        value={companyId}
                        onChange={(event) => setCompanyId(event.target.value)}
                      >
                        <option value="">Select company</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.companyName}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : null}
                  <Label htmlFor={`deadline-${record.id}`}>Deadline (optional)</Label>
                  <Input
                    id={`deadline-${record.id}`}
                    type="date"
                    value={requiredDate}
                    onChange={(event) => setRequiredDate(event.target.value)}
                  />
                  <Label htmlFor={`notes-${record.id}`}>Notes (optional)</Label>
                  <Textarea
                    id={`notes-${record.id}`}
                    value={createNotes}
                    onChange={(event) => setCreateNotes(event.target.value)}
                    rows={2}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      busy ||
                      !projectName.trim() ||
                      (billingType !== "internal" && !companyId)
                    }
                    onClick={() =>
                      onAction({
                        action: "create_job",
                        billingType,
                        projectName: projectName.trim(),
                        companyId: billingType === "internal" ? null : companyId,
                        requiredDate: requiredDate || null,
                        notes: createNotes.trim() || null,
                      })
                    }
                  >
                    Create {JOB_BILLING_TYPE_LABELS[billingType]} job
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {canManageLinkedJobs ? (
            <div className="space-y-3 rounded-lg border border-border px-3 py-3">
              <p className="text-sm font-medium text-foreground">Shared print links</p>
              <Button
                type="button"
                size="sm"
                variant={activeAction === "add_job" ? "default" : "outline"}
                disabled={busy}
                onClick={() =>
                  setActiveAction((current) => (current === "add_job" ? null : "add_job"))
                }
              >
                Add another job
              </Button>
              {activeAction === "add_job" ? (
                <div className="space-y-2">
                  <Label htmlFor={`add-search-${record.id}`}>Search Candid jobs</Label>
                  <Input
                    id={`add-search-${record.id}`}
                    value={jobSearch}
                    onChange={(event) => setJobSearch(event.target.value)}
                    placeholder="Job reference, project, or company"
                  />
                  {searchingJobs ? (
                    <p className="text-xs text-muted-foreground">Searching…</p>
                  ) : null}
                  {jobResults.length > 0 ? (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border">
                      {jobResults.map((job) => {
                        const alreadyLinked = linkedJobIds.has(job.id);

                        return (
                          <button
                            key={job.id}
                            type="button"
                            disabled={alreadyLinked}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() =>
                              onAction({
                                action: "add_linked_job",
                                candidJobId: job.id,
                              })
                            }
                          >
                            <span className="font-medium text-foreground">
                              {job.jobReference}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {job.projectName} · {job.companyName}
                              {alreadyLinked ? " · already linked" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
              <p className="text-sm font-medium text-foreground">Suggested manifest items</p>
              {suggestions.map((link) => (
                <div
                  key={link.id}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p>
                    {link.production_items?.item_reference ?? "—"} ·{" "}
                    {link.production_items?.item_name ?? "Unknown item"}
                  </p>
                  {tab !== "matched" ? (
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

          {tab !== "ignored" && record.job_match_status !== "ignored" ? (
            <div className="space-y-2">
              <Label htmlFor={`ignore-${record.id}`}>Ignore reason</Label>
              <Textarea
                id={`ignore-${record.id}`}
                value={ignoreReason}
                onChange={(event) => setIgnoreReason(event.target.value)}
                rows={2}
                placeholder="Calibration, duplicate, test file, etc."
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !ignoreReason.trim()}
                onClick={() => {
                  if (linkedJobs.length > 0) {
                    const confirmed = window.confirm(
                      `This PrintFactory job is currently linked to ${linkedJobs.length} Candid job${linkedJobs.length === 1 ? "" : "s"}. Ignore anyway? Existing links will remain until removed manually.`
                    );

                    if (!confirmed) {
                      return;
                    }
                  }

                  onAction({
                    action: "ignore",
                    reason: ignoreReason.trim(),
                  });
                }}
              >
                Ignore
              </Button>
            </div>
          ) : null}

          {(tab === "ignored" || record.job_match_status === "ignored") &&
          record.job_match_status === "ignored" ? (
            <div className="space-y-3 rounded-lg border border-border px-3 py-3">
              <p className="text-sm font-medium text-foreground">Ignored</p>
              {record.ignore_reason ? (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Reason:</span>{" "}
                  {record.ignore_reason}
                </p>
              ) : null}
              {record.ignored_at ? (
                <p className="text-xs text-muted-foreground">
                  Ignored {formatCrmDateTime(record.ignored_at)}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => onAction({ action: "restore" })}
              >
                Restore
              </Button>
              <p className="text-xs text-muted-foreground">
                Returns this record to Needs Attention without re-importing or
                changing source paths.
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
