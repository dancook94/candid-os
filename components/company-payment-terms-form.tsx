"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMMON_PAYMENT_TERMS_DAYS,
  parsePaymentTermsDays,
  PAYMENT_TERMS_MAX_DAYS,
  PAYMENT_TERMS_MIN_DAYS,
} from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type CompanyPaymentTermsFormProps = {
  companyId: string;
  initialPaymentTermsDays: number | null;
};

export function CompanyPaymentTermsForm({
  companyId,
  initialPaymentTermsDays,
}: CompanyPaymentTermsFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [paymentTermsDays, setPaymentTermsDays] = useState(
    String(initialPaymentTermsDays ?? 14)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const parsedPaymentTerms = parsePaymentTermsDays(paymentTermsDays);

    if (parsedPaymentTerms === null) {
      setError(
        `Payment terms must be a whole number between ${PAYMENT_TERMS_MIN_DAYS} and ${PAYMENT_TERMS_MAX_DAYS}.`
      );
      return;
    }

    setIsSubmitting(true);

    const { error: updateError } = await supabase
      .from("companies")
      .update({ payment_terms_days: parsedPaymentTerms })
      .eq("id", companyId);

    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Payment terms saved.");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="company-payment-terms">Payment terms (days)</Label>
        <Input
          id="company-payment-terms"
          type="number"
          min={PAYMENT_TERMS_MIN_DAYS}
          max={PAYMENT_TERMS_MAX_DAYS}
          step={1}
          value={paymentTermsDays}
          onChange={(event) => setPaymentTermsDays(event.target.value)}
          disabled={isSubmitting}
          required
        />
        <p className="text-sm text-muted-foreground">
          Used as the default when creating new quotes for this company.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {COMMON_PAYMENT_TERMS_DAYS.map((days) => (
          <button
            key={days}
            type="button"
            disabled={isSubmitting}
            onClick={() => setPaymentTermsDays(String(days))}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              paymentTermsDays === String(days)
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            {days === 0 ? "Due immediately" : `${days} days`}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save payment terms"}
      </Button>
    </form>
  );
}
