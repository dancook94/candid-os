"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  receivePurchaseOrderGoods,
  sendPurchaseOrderToSupplier,
} from "@/lib/purchasing/actions";
import {
  purchaseOrderCanSendEmail,
  purchaseOrderEmailRecipientEditable,
} from "@/lib/purchasing/purchase-order-dispatch-ui";
import type {
  IssuedPurchaseOrderContext,
  IssuedPurchaseOrderLine,
} from "@/lib/purchasing/purchase-order-issued";

function formatQty(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function dispatchLabel(status: string) {
  switch (status) {
    case "sent":
      return "Sent to supplier";
    case "sending":
      return "Sending…";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
    case "unknown":
      return "Delivery unconfirmed";
    default:
      return status;
  }
}

export function PurchaseOrderIssuedPanel({
  context,
}: {
  context: IssuedPurchaseOrderContext;
}) {
  const [email, setEmail] = useState(context.supplierOrdersEmail);
  const [confirmed, setConfirmed] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [sendPending, setSendPending] = useState(false);
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null);
  const [receivePending, setReceivePending] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const canSend = purchaseOrderCanSendEmail(context.emailDispatch);
  const emailEditable = purchaseOrderEmailRecipientEditable(context.emailDispatch);
  const dispatch = context.emailDispatch;

  const outstandingLines = useMemo(
    () =>
      context.lines.filter((line) => line.receivedQuantity + 0.0001 < line.quantity),
    [context.lines]
  );

  async function onSend(event: React.FormEvent) {
    event.preventDefault();
    if (sendPending || !canSend) {
      return;
    }
    setSendPending(true);
    setSendMessage(null);
    const result = await sendPurchaseOrderToSupplier({
      orderId: context.orderId,
      revisionId: context.revisionId,
      supplierOrdersEmail: email,
      confirmed,
    });
    setSendPending(false);
    if (!result.ok) {
      setSendMessage(result.message);
      return;
    }
    if (result.status === "already_sent") {
      setSendMessage("This purchase order was already emailed to the supplier.");
      return;
    }
    setSendMessage("Purchase order emailed to the supplier.");
    setConfirmed(false);
  }

  async function onReceive(event: React.FormEvent) {
    event.preventDefault();
    if (receivePending) {
      return;
    }
    setReceivePending(true);
    setReceiveMessage(null);
    const lines = context.lines.flatMap((line) => {
      const quantity = receiveQty[line.id]?.trim() ?? "";
      if (!quantity) {
        return [];
      }
      return [{ lineId: line.id, quantity }];
    });
    const result = await receivePurchaseOrderGoods({
      orderId: context.orderId,
      idempotencyKey: crypto.randomUUID(),
      lines,
    });
    setReceivePending(false);
    if (!result.ok) {
      setReceiveMessage(result.message);
      return;
    }
    setReceiveMessage("Receipt recorded.");
    setReceiveQty({});
  }

  return (
    <div className="space-y-6">
      <Card className="portal-surface">
        <CardContent className="space-y-4 px-4 py-6 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Email to supplier</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sends the issued PDF to the supplier. This cannot be repeated after a successful
              send.
            </p>
          </div>

          {dispatch ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Send status</dt>
                <dd className="font-medium">{dispatchLabel(dispatch.status)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd>{new Date(dispatch.updatedAt).toLocaleString()}</dd>
              </div>
              {dispatch.providerMessageId ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Provider reference</dt>
                  <dd className="font-mono text-xs">{dispatch.providerMessageId}</dd>
                </div>
              ) : null}
              {dispatch.lastError ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Last error</dt>
                  <dd className="text-destructive">{dispatch.lastError}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Not emailed yet.</p>
          )}

          <form className="space-y-4" onSubmit={onSend}>
            <div className="space-y-1.5">
              <Label htmlFor="po-supplier-email">Supplier email</Label>
              <Input
                id="po-supplier-email"
                type="email"
                autoComplete="off"
                value={email}
                disabled={!emailEditable || sendPending || !canSend}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                disabled={sendPending || !canSend}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I confirm this purchase order should be emailed to the supplier at the address
                above, with the PDF attached.
              </span>
            </label>
            {sendMessage ? (
              <p className="text-sm text-muted-foreground" role="status">
                {sendMessage}
              </p>
            ) : null}
            <Button type="submit" disabled={sendPending || !canSend || !confirmed}>
              {sendPending ? "Sending…" : "Send purchase order email"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="portal-surface">
        <CardContent className="space-y-4 px-4 py-6 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Receive goods</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record full or partial receipts. Quantities cannot exceed what is still outstanding.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="portal-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Line</th>
                  <th className="text-right">Ordered</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Receive now</th>
                </tr>
              </thead>
              <tbody>
                {context.lines.map((line) => (
                  <ReceiveLineRow
                    key={line.id}
                    line={line}
                    value={receiveQty[line.id] ?? ""}
                    disabled={receivePending}
                    onChange={(value) =>
                      setReceiveQty((current) => ({ ...current, [line.id]: value }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={onReceive} className="space-y-3">
            {receiveMessage ? (
              <p className="text-sm text-muted-foreground" role="status">
                {receiveMessage}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="outline"
              disabled={receivePending || outstandingLines.length === 0}
            >
              {receivePending ? "Saving…" : "Record receipt"}
            </Button>
          </form>

          {context.receipts.length > 0 ? (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Receiving history</h3>
              <ul className="space-y-3 text-sm">
                {context.receipts.map((receipt) => (
                  <li key={receipt.id} className="rounded-lg border border-border p-3">
                    <p className="font-medium">
                      {new Date(receipt.receivedAt).toLocaleString()}
                      {receipt.receivedByName ? ` · ${receipt.receivedByName}` : ""}
                    </p>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {receipt.lines.map((line) => {
                        const detail = context.lines.find((entry) => entry.id === line.lineId);
                        return (
                          <li key={`${receipt.id}-${line.lineId}`}>
                            {detail?.description ?? "Line"}: {formatQty(line.quantity)}{" "}
                            {detail?.unit ?? ""}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ReceiveLineRow({
  line,
  value,
  disabled,
  onChange,
}: {
  line: IssuedPurchaseOrderLine;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const outstanding = Math.max(0, line.quantity - line.receivedQuantity);

  return (
    <tr>
      <td className="py-2 pr-4">
        <span className="font-medium">{line.description || `Line ${line.lineNumber}`}</span>
      </td>
      <td className="py-2 text-right tabular-nums">{formatQty(line.quantity)}</td>
      <td className="py-2 text-right tabular-nums">{formatQty(line.receivedQuantity)}</td>
      <td className="py-2 text-right tabular-nums">{formatQty(outstanding)}</td>
      <td className="py-2 pl-4">
        <Input
          type="number"
          min={0}
          max={outstanding}
          step="0.0001"
          disabled={disabled || outstanding <= 0}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="ml-auto h-8 max-w-[8rem] text-right"
          aria-label={`Receive quantity for line ${line.lineNumber}`}
        />
      </td>
    </tr>
  );
}
