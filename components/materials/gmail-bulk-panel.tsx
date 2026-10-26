"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  bulkCounts,
  failedItemIds,
  initialBulkRun,
  reduceBulkRun,
  type BulkRun,
} from "@/lib/materials/invoices/gmail-bulk";
import type { PromotionPreviewRow, PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";
import {
  INVOICE_PROCESSING_ALL_ELIGIBLE,
  INVOICE_PROCESSING_DEFAULT_BATCH_SIZE,
  INVOICE_PROCESSING_DEFAULT_LIMIT,
  INVOICE_PROCESSING_LIMIT_CHOICES,
  completionReasonText,
  processingProgress,
  type PersistedProcessingRun,
} from "@/lib/materials/invoices/processing-run";

type BulkResponse = {
  report: PromotionReport;
  pending: number;
  error?: string;
};

export function GmailBulkPanel(props: {
  rows: PromotionPreviewRow[];
  reviewCount: number | null;
  error?: string | null;
  background?: "ready" | "unavailable";
  persisted?: PersistedProcessingRun | null;
}) {
  if (props.background === "ready") {
    return <PersistentBulkPanel {...props} persisted={props.persisted ?? null} />;
  }

  return <BrowserBulkPanel {...props} />;
}

function PersistentBulkPanel(props: {
  rows: PromotionPreviewRow[];
  reviewCount: number | null;
  error?: string | null;
  persisted: PersistedProcessingRun | null;
}) {
  const router = useRouter();
  const counts = bulkCounts(props.rows);
  const persisted = props.persisted;
  const [batchSize, setBatchSize] = useState(persisted?.batchSize ?? INVOICE_PROCESSING_DEFAULT_BATCH_SIZE);
  const [invoiceLimit, setInvoiceLimit] = useState(String(INVOICE_PROCESSING_DEFAULT_LIMIT));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pauseRef = useRef(false);
  const runningRef = useRef(false);
  const held = new Set(persisted?.heldItemIds ?? []);
  const waiting = props.rows.filter((row) => row.selectable && !held.has(row.itemId)).length;
  const status = persisted?.status ?? "idle";
  const progress = persisted ? processingProgress(persisted) : null;

  useEffect(() => {
    if (status !== "running" || busy) {
      return;
    }

    const timer = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [busy, router, status]);

  async function send(command: "start" | "pause" | "resume" | "retry" | "tick") {
    const response = await fetch("/api/admin/materials/invoices/gmail/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "processing",
        command,
        batchSize,
        invoiceLimit: invoiceLimit === INVOICE_PROCESSING_ALL_ELIGIBLE ? INVOICE_PROCESSING_ALL_ELIGIBLE : Number(invoiceLimit),
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      processing?: { status?: string; error?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error || "The stored invoices could not be processed.");
    }

    return payload.processing ?? { status: "idle" };
  }

  async function runUntilPaused(command: "start" | "resume" | "retry" | "tick") {
    if (runningRef.current) {
      return;
    }

    runningRef.current = true;
    pauseRef.current = false;
    setBusy(true);
    setError(null);

    try {
      let next: "start" | "resume" | "retry" | "tick" = command;

      while (!pauseRef.current) {
        const result = await send(next);
        next = "tick";
        router.refresh();

        if (result.error) {
          setError(result.error);
          break;
        }

        if (pauseRef.current || result.status === "paused" || result.status === "completed" || result.status === "idle") {
          break;
        }

        if (result.status === "attention") {
          break;
        }

        if (result.status === "busy") {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The stored invoices could not be processed.");
    } finally {
      runningRef.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Process stored invoices</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This works through invoice PDFs already saved from Gmail. It does not look in the mailbox.
          Choose a maximum before starting. That list is fixed for the run, including later scheduled ticks.
          You can close this page. Processing continues about every 15 minutes until the maximum or the queue is finished.
          Recognised products are matched for review. New materials and price changes stay waiting for a person to approve them.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Stored invoices" value={counts.eligible} />
        <Stat label="Already in review" value={counts.processed} />
        <Stat label="Waiting" value={waiting} />
        <Stat label="Duplicates" value={counts.duplicates} />
        <Stat label="Failed this run" value={persisted?.failed ?? 0} />
        <Stat label="Need a person" value={props.reviewCount} />
        <Stat
          label="Maximum invoices"
          value={
            progress
              ? progress.maximum
              : invoiceLimit === INVOICE_PROCESSING_ALL_ELIGIBLE
                ? counts.pending
                : Number(invoiceLimit)
          }
        />
        <Stat label="Processed invoices" value={progress?.processed ?? 0} />
        <Stat label="Remaining allowance" value={progress?.remaining ?? null} />
      </dl>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Invoices per batch
          <Select
            className="mt-1 w-28"
            value={String(batchSize)}
            disabled={busy || status === "running" || status === "paused"}
            onChange={(event) => setBatchSize(Number(event.target.value))}
          >
            {[1, 2, 5, 10].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Maximum invoices
          <Select
            className="mt-1 w-52"
            value={invoiceLimit}
            disabled={busy || status === "running" || status === "paused"}
            onChange={(event) => setInvoiceLimit(event.target.value)}
          >
            {INVOICE_PROCESSING_LIMIT_CHOICES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            <option value={INVOICE_PROCESSING_ALL_ELIGIBLE}>All currently eligible</option>
          </Select>
        </label>
        <Button
          type="button"
          disabled={busy || status === "running" || status === "paused" || waiting === 0}
          onClick={() => void runUntilPaused("start")}
        >
          Start processing
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!busy && status !== "running"}
          onClick={() => {
            pauseRef.current = true;
            void send("pause")
              .catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "Processing could not be paused.");
              })
              .finally(() => router.refresh());
          }}
        >
          Pause
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || status !== "paused"}
          onClick={() => void runUntilPaused("resume")}
        >
          Resume
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || status !== "running" || waiting === 0}
          onClick={() => {
            setBusy(true);
            void send("tick")
              .then((result) => {
                if (result.error) {
                  setError(result.error);
                }
              })
              .catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "The stored invoices could not be processed.");
              })
              .finally(() => {
                setBusy(false);
                router.refresh();
              });
          }}
        >
          Process the next batch now
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || (persisted?.failedItemIds.length ?? 0) === 0}
          onClick={() => void runUntilPaused("retry")}
        >
          Retry failed invoices
        </Button>
        <Link href="/admin/materials/invoices/exceptions" className="text-sm underline-offset-4 hover:underline">
          Open the review queue
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {persistentStatusText(status, waiting, persisted)}
        {(persisted?.extractionFailures ?? 0) > 0
          ? ` ${persisted?.extractionFailures} promoted invoice${persisted?.extractionFailures === 1 ? "" : "s"} had no readable lines.`
          : ""}
      </p>
      {persisted && persisted.recent.length > 0 ? (
        <ul className="max-h-48 space-y-1 overflow-auto text-sm text-muted-foreground">
          {persisted.recent.map((result) => (
            <li key={`${result.itemId}-${result.outcome}`}>{result.detail}</li>
          ))}
        </ul>
      ) : null}
      {error || props.error ? <p className="text-sm text-amber-900">{error || props.error}</p> : null}
    </section>
  );
}

function BrowserBulkPanel(props: {
  rows: PromotionPreviewRow[];
  reviewCount: number | null;
  error?: string | null;
}) {
  const router = useRouter();
  const counts = bulkCounts(props.rows);
  const [batchSize, setBatchSize] = useState(5);
  const [run, setRun] = useState<BulkRun>(() => initialBulkRun(5));
  const [error, setError] = useState<string | null>(null);
  const pauseRef = useRef(false);
  const runningRef = useRef(false);

  async function process(input: { itemIds?: string[]; skipItemIds: string[] }) {
    const response = await fetch("/api/admin/materials/invoices/gmail/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "bulk",
        batchSize,
        skipItemIds: input.skipItemIds,
        itemIds: input.itemIds,
      }),
    });
    const payload = (await response.json()) as BulkResponse;

    if (!response.ok) {
      throw new Error(payload.error || "The batch could not be processed.");
    }

    return payload;
  }

  function begin(start: BulkRun, itemIds?: string[]) {
    if (runningRef.current) {
      return;
    }

    runningRef.current = true;
    pauseRef.current = false;
    void runLoop(start, itemIds);
  }

  async function runLoop(start: BulkRun, itemIds?: string[]) {
    setError(null);
    let current = start;

    try {
      do {
        const payload = await process({
          itemIds: current === start ? itemIds : undefined,
          skipItemIds: current.skipItemIds,
        });
        current = reduceBulkRun(current, {
          type: "batch",
          report: payload.report,
          pending: payload.pending,
        });
        if (pauseRef.current && current.status === "running") {
          current = reduceBulkRun(current, { type: "pause" });
        }
        setRun(current);
        itemIds = undefined;

        if (payload.report.results.length === 0 || current.status !== "running") {
          break;
        }
      } while (!pauseRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The batch could not be processed.");
      setRun((existing) => (existing.status === "running" ? reduceBulkRun(existing, { type: "pause" }) : existing));
    } finally {
      runningRef.current = false;
      router.refresh();
    }
  }

  const failed = failedItemIds(run);
  const busy = run.status === "running";

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Process stored invoices</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This works through invoice PDFs already saved from Gmail. It does not look in the mailbox.
          Closing this page stops processing. Recognised products are matched for review. New
          materials and price changes stay waiting for a person to approve them.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Stored invoices" value={counts.eligible} />
        <Stat label="Already in review" value={counts.processed} />
        <Stat label="Waiting" value={counts.pending} />
        <Stat label="Duplicates" value={counts.duplicates} />
        <Stat label="Failed this run" value={run.failed} />
        <Stat label="Need a person" value={props.reviewCount} />
      </dl>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Invoices per batch
          <Select
            className="mt-1 w-28"
            value={String(batchSize)}
            disabled={busy}
            onChange={(event) => {
              const next = Number(event.target.value);
              setBatchSize(next);
              setRun((existing) => ({ ...existing, batchSize: next }));
            }}
          >
            {[1, 2, 5, 10].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="button"
          disabled={busy || counts.pending === 0}
          onClick={() => {
            const started = reduceBulkRun({ ...run, batchSize }, { type: "start" });
            setRun(started);
            begin(started);
          }}
        >
          Start processing
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!busy}
          onClick={() => {
            pauseRef.current = true;
            setRun((existing) => reduceBulkRun(existing, { type: "pause" }));
          }}
        >
          Pause
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || run.status !== "paused"}
          onClick={() => {
            const resumed = reduceBulkRun(run, { type: "resume" });
            setRun(resumed);
            if (resumed.status === "running") {
              begin(resumed);
            }
          }}
        >
          Resume
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || failed.length === 0}
          onClick={() => {
            const retried = reduceBulkRun(run, { type: "retry" });
            setRun(retried);
            begin(retried, failed);
          }}
        >
          Retry failed invoices
        </Button>
        <Link href="/admin/materials/invoices/exceptions" className="text-sm underline-offset-4 hover:underline">
          Open the review queue
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {statusText(run, counts.pending)}
        {run.extractionFailures > 0
          ? ` ${run.extractionFailures} promoted invoice${run.extractionFailures === 1 ? "" : "s"} had no readable lines.`
          : ""}
      </p>
      {run.results.length > 0 ? (
        <ul className="max-h-48 space-y-1 overflow-auto text-sm text-muted-foreground">
          {run.results.map((result) => (
            <li key={`${result.itemId}-${result.outcome}`}>
              {result.invoiceNumber ?? result.filename}: {result.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {error || props.error ? <p className="text-sm text-amber-900">{error || props.error}</p> : null}
    </section>
  );
}

function Stat(props: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border border-border/70 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="text-lg font-semibold">{props.value ?? "—"}</dd>
    </div>
  );
}

function persistentStatusText(
  status: PersistedProcessingRun["status"] | "idle",
  waiting: number,
  run: PersistedProcessingRun | null
) {
  const counts = `${run?.promoted ?? 0} added to review, ${run?.duplicate ?? 0} duplicates, ${run?.skipped ?? 0} skipped, ${run?.failed ?? 0} failed.`;
  const progress = run ? processingProgress(run) : null;
  const allowance = progress
    ? ` Batch size ${run?.batchSize}. Maximum ${progress.maximum}. ${progress.processed} processed. ${progress.remaining} remaining in this run.${
        progress.authorised < progress.maximum ? ` Only ${progress.authorised} eligible invoices were included.` : ""
      }`
    : "";

  if (status === "paused") {
    return `Paused. ${counts} Nothing else runs until you resume.${allowance}`;
  }

  if (status === "completed") {
    const reason = run ? completionReasonText(run) : "";
    return `Finished. ${counts}${reason ? ` ${reason}` : ""}${allowance}`;
  }

  if (status === "running") {
    return `Working in the background. ${counts} You can close this page.${allowance}`;
  }

  return `${waiting} stored invoice${waiting === 1 ? "" : "s"} can be added to review. The maximum is fixed when you start.`;
}

function statusText(run: BulkRun, waiting: number) {
  if (run.status === "idle") {
    return `${waiting} stored invoice${waiting === 1 ? "" : "s"} can be added to review.`;
  }

  if (run.status === "paused") {
    return `Paused. ${run.promoted} added to review, ${run.duplicate} duplicates, ${run.failed} failed.`;
  }

  if (run.status === "complete") {
    return `Finished. ${run.promoted} added to review, ${run.duplicate} duplicates, ${run.skipped} skipped, ${run.failed} failed.`;
  }

  return `Working. ${run.promoted} added to review so far. ${run.pending ?? waiting} still waiting.`;
}
