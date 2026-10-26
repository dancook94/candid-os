"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { issuePurchaseOrder } from "@/lib/purchasing/actions";

export function IssuePurchaseOrderForm({
  orderId,
  idempotencyKey,
  disabled,
}: {
  orderId: string;
  idempotencyKey: string;
  disabled: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || disabled) {
          return;
        }
        setPending(true);
        setMessage(null);
        const result = await issuePurchaseOrder(orderId, idempotencyKey);
        if (result) {
          setMessage(result.message);
          setPending(false);
        }
      }}
    >
      {message ? (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled || pending}>
        {pending ? "Issuing…" : "Issue purchase order"}
      </Button>
    </form>
  );
}
