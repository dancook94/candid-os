"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InvoiceUploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a PDF, JPG, or PNG invoice.");
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch("/api/admin/materials/invoices", {
      method: "POST",
      body: new FormData(form),
    });
    const payload = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok || !payload?.invoiceId) {
      setError(payload?.error ?? "The invoice could not be uploaded.");
      return;
    }

    const duplicate = payload.duplicate ? "?duplicate=1" : "";
    router.push(`/admin/materials/invoices/${payload.invoiceId}${duplicate}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <Label htmlFor="invoice-file">Invoice file</Label>
        <Input
          id="invoice-file"
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          className="mt-2"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Reading invoice…" : "Upload supplier invoice"}
      </Button>
      {error ? <p className="text-sm text-red-700 sm:basis-full">{error}</p> : null}
    </form>
  );
}
