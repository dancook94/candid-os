"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  GMAIL_PROMOTION_BATCH_LIMIT,
  selectPyramidPilot,
  type PromotionPreviewRow,
  type PromotionReport,
} from "@/lib/materials/invoices/gmail-promotion-view";

export function GmailPromotionPanel(props: {
  rows: PromotionPreviewRow[];
  error: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PromotionReport | null>(null);
  const ready = props.rows.filter((row) => row.selectable);

  function toggle(itemId: string) {
    setSelected((current) => {
      if (current.includes(itemId)) {
        return current.filter((id) => id !== itemId);
      }

      if (current.length >= GMAIL_PROMOTION_BATCH_LIMIT) {
        return current;
      }

      return [...current, itemId];
    });
  }

  async function promote() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/materials/invoices/gmail/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "promote", mode: "automatic", itemIds: selected }),
      });
      const payload = (await response.json()) as PromotionReport & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "The invoices could not be promoted.");
      }

      setReport(payload);
      setSelected([]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invoices could not be promoted.");
    } finally {
      setBusy(false);
    }
  }

  async function classifyManually(itemId: string) {
    const confirmed = window.confirm(
      "Check this stored PDF? A clear supplier invoice is added to review. A statement, reminder, or credit-control letter is excluded. The original PDF and checksum stay stored."
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/materials/invoices/gmail/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "promote", mode: "manual", itemIds: [itemId] }),
      });
      const payload = (await response.json()) as PromotionReport & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "The document could not be classified.");
      }

      setReport(payload);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document could not be classified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Promote stored invoices</h2>
      <p className="text-sm text-muted-foreground">
        These PDFs are already in private storage. Promotion copies up to {GMAIL_PROMOTION_BATCH_LIMIT}{" "}
        into supplier invoice review. It does not scan Gmail, and it does not create materials or
        approved prices. Pyramid invoices are listed first.
      </p>
      {props.error ? <p className="text-sm text-amber-900">{props.error}</p> : null}
      {props.rows.length === 0 && !props.error ? (
        <p className="text-sm text-muted-foreground">No stored invoice PDFs are waiting.</p>
      ) : null}
      {props.rows.length > 0 ? (
        <ul className="divide-y rounded-2xl border">
          {props.rows.map((row) => (
            <li key={row.itemId} className="flex items-start gap-3 px-4 py-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(row.itemId)}
                disabled={!row.selectable || busy}
                aria-label={`Select ${row.filename}`}
                onChange={() => toggle(row.itemId)}
              />
              <div>
                <p className="font-medium">
                  {row.supplierName ?? "Supplier not recognised"}
                  {row.pyramid ? " · Pyramid pilot" : ""}
                </p>
                <p className="text-muted-foreground">
                  {row.invoiceNumber ?? "No invoice number"} · {row.invoiceDate ?? "No invoice date"} ·{" "}
                  {row.filename}
                </p>
                <p className="text-muted-foreground">
                  {row.queueReason ?? (row.duplicate ? row.duplicate.detail : "Ready for review")}
                </p>
                {row.queue === "manual" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => void classifyManually(row.itemId)}
                  >
                    Check this document
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {report ? (
        <div className="space-y-1 text-sm">
          <p>
            Promoted {report.promoted}. Duplicates {report.duplicate}. Skipped {report.skipped}. Failed{" "}
            {report.failed}.
          </p>
          {report.results.map((result) => (
            <p key={result.itemId} className="text-muted-foreground">
              {result.outcome}: {result.filename || result.itemId}. {result.detail}
            </p>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm text-amber-900">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || ready.length === 0}
          onClick={() => setSelected(selectPyramidPilot(props.rows))}
        >
          Select 10 Pyramid invoices
        </Button>
        <Button type="button" disabled={busy || selected.length === 0} onClick={() => void promote()}>
          Promote selected ({selected.length})
        </Button>
      </div>
    </section>
  );
}
