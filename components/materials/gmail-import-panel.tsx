"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GmailConnectionView, GmailItemView, GmailRunView } from "@/lib/gmail/connection";
import { GMAIL_DISCOVERY_FROM, GMAIL_DISCOVERY_TO } from "@/lib/gmail/config";
import { gmailDiscoveryContinuation } from "@/lib/gmail/progress";

const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  sales_order: "Sales order",
  delivery_note: "Delivery note",
  unknown: "Unknown",
  unsupported_image: "Image",
};

export function GmailImportPanel(props: {
  connection: GmailConnectionView;
  run: GmailRunView | null;
  items: GmailItemView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(props.run?.dateFrom ?? GMAIL_DISCOVERY_FROM);
  const [dateTo, setDateTo] = useState(props.run?.dateTo ?? GMAIL_DISCOVERY_TO);
  const connected = props.connection.status === "connected";

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      error?: string;
      status?: string;
      busy?: boolean;
      rateLimited?: boolean;
      retryAfterSeconds?: number;
    };
    if (!response.ok) {
      throw new Error(payload.error || "The request failed.");
    }
    return payload;
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);

    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Connection</h2>
        <p className="text-sm text-muted-foreground">
          Mailbox {props.connection.mailbox}. Status {props.connection.status.replaceAll("_", " ")}.
          {props.connection.googleEmail ? ` Confirmed ${props.connection.googleEmail}.` : ""}
          {props.connection.lastSuccessAt
            ? ` Last success ${props.connection.lastSuccessAt.slice(0, 16).replace("T", " ")} UTC.`
            : ""}
        </p>
        {props.connection.missingEnv.length > 0 ? (
          <p className="text-sm text-amber-900">
            Missing environment variables: {props.connection.missingEnv.join(", ")}.
          </p>
        ) : null}
        {props.connection.lastError ? (
          <p className="text-sm text-amber-900">{props.connection.lastError}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction(() => post("/api/admin/materials/invoices/gmail/discovery", { action: "health" }).then(() => undefined))
                }
              >
                Check connection
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction(() => post("/api/admin/materials/invoices/gmail/disconnect").then(() => undefined))
                }
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled={busy || !props.connection.credentialsConfigured}
              onClick={() => {
                window.location.href = "/api/admin/materials/invoices/gmail/connect";
              }}
            >
              Connect Gmail
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Historical discovery</h2>
        <p className="text-sm text-muted-foreground">
          Scans Inbox, Archive and Sent, and skips Spam, Trash and drafts. Start discovery once.
          A background scan continues every 15 minutes until this date range is finished, paused,
          or needs attention. This pass records documents only. It does not create supplier
          invoices, materials, or prices.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gmail-from">From</Label>
            <Input id="gmail-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gmail-to">To</Label>
            <Input id="gmail-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
        </div>
        <p className="text-sm">{gmailDiscoveryContinuation(props.run?.status ?? null)}</p>
        {props.run ? (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <p>Status: {props.run.status}</p>
            <p>Messages scanned: {props.run.messagesSeen}</p>
            <p>PDF attachments: {props.run.pdfsSeen}</p>
            <p>Candidate invoices: {props.run.invoicesFound}</p>
            <p>Duplicates: {props.run.duplicatesFound}</p>
            <p>Credit notes: {props.run.creditNotesFound}</p>
            <p>
              Non-invoice documents:{" "}
              {props.run.salesOrdersFound +
                props.run.deliveryNotesFound +
                props.run.unknownFound +
                props.run.skippedFound +
                props.run.imagesSeen}
            </p>
            <p>Failed items: {props.run.failures}</p>
            <p>
              Last processing:{" "}
              {props.run.updatedAt
                ? `${props.run.updatedAt.slice(0, 16).replace("T", " ")} UTC`
                : "Not yet"}
            </p>
          </div>
        ) : null}
        {props.run?.lastError ? <p className="text-sm text-amber-900">{props.run.lastError}</p> : null}
        {error ? <p className="text-sm text-amber-900">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || !connected || props.run?.status === "running" || props.run?.status === "paused"}
            onClick={() =>
              runAction(() =>
                post("/api/admin/materials/invoices/gmail/discovery", {
                  action: "start",
                  dateFrom,
                  dateTo,
                }).then(() => undefined)
              )
            }
          >
            Start discovery
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || props.run?.status !== "running"}
            onClick={() =>
              runAction(() =>
                post("/api/admin/materials/invoices/gmail/discovery", { action: "step" }).then(() => undefined)
              )
            }
          >
            Scan a batch now
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || props.run?.status !== "running"}
            onClick={() =>
              runAction(() =>
                post("/api/admin/materials/invoices/gmail/discovery", { action: "pause" }).then(() => undefined)
              )
            }
          >
            Pause
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || props.run?.status !== "paused"}
            onClick={() =>
              runAction(() =>
                post("/api/admin/materials/invoices/gmail/discovery", { action: "resume" }).then(() => undefined)
              )
            }
          >
            Resume
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !connected || !props.run || props.run.failures === 0}
            onClick={() =>
              runAction(() =>
                post("/api/admin/materials/invoices/gmail/discovery", { action: "retry" }).then(() => undefined)
              )
            }
          >
            Retry failures
          </Button>
        </div>
      </section>

      {props.items.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent discovery records</h2>
          <ul className="divide-y rounded-2xl border">
            {props.items.map((item) => (
              <li key={item.id} className="space-y-1 px-4 py-3 text-sm">
                <p className="font-medium">{item.filename}</p>
                <p className="text-muted-foreground">
                  {TYPE_LABELS[item.documentType] ?? item.documentType} · {item.status}
                  {item.invoiceNumber ? ` · ${item.invoiceNumber}` : ""}
                  {item.invoiceDate ? ` · ${item.invoiceDate}` : ""}
                  {item.supplierNote ? ` · ${item.supplierNote}` : ""}
                </p>
                {item.detail ? <p className="text-muted-foreground">{item.detail}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
