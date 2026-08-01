"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function CreateCompanyDialog() {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [accountsEmail, setAccountsEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("14");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function resetForm() {
    setCompanyName("");
    setTradingName("");
    setAccountsEmail("");
    setPhone("");
    setVatNumber("");
    setPaymentTermsDays("14");
    setError("");
    setSuccess("");
  }

  function handleClose() {
    if (isSubmitting) {
      return;
    }

    setOpen(false);
    resetForm();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const trimmedCompanyName = companyName.trim();

    if (!trimmedCompanyName) {
      setError("Legal company name is required.");
      return;
    }

    const parsedPaymentTerms = Number.parseInt(paymentTermsDays, 10);

    if (!Number.isFinite(parsedPaymentTerms) || parsedPaymentTerms < 0) {
      setError("Payment terms must be a valid number of days.");
      return;
    }

    setIsSubmitting(true);

    const { error: insertError } = await supabase.from("companies").insert({
      company_name: trimmedCompanyName,
      trading_name: tradingName.trim() || null,
      accounts_email: accountsEmail.trim() || null,
      phone: phone.trim() || null,
      vat_number: vatNumber.trim() || null,
      payment_terms_days: parsedPaymentTerms,
      is_active: true,
    });

    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccess(`${trimmedCompanyName} created successfully.`);
    router.refresh();

    window.setTimeout(() => {
      handleClose();
    }, 800);
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        + New Company
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={handleClose}
          />

          <Card className="relative z-10 w-full max-w-lg rounded-2xl border-neutral-200 shadow-lg ring-0">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-lg font-semibold text-neutral-950">
                Create company
              </CardTitle>
              <CardDescription>
                Add a new customer company to Candid OS.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="company-name">Legal company name</Label>
                  <Input
                    id="company-name"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    placeholder="Acme Ltd"
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trading-name">Trading name</Label>
                  <Input
                    id="trading-name"
                    value={tradingName}
                    onChange={(event) => setTradingName(event.target.value)}
                    placeholder="Optional"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="accounts-email">Accounts email</Label>
                  <Input
                    id="accounts-email"
                    type="email"
                    value={accountsEmail}
                    onChange={(event) => setAccountsEmail(event.target.value)}
                    placeholder="accounts@company.com"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Optional"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vat-number">VAT number</Label>
                  <Input
                    id="vat-number"
                    value={vatNumber}
                    onChange={(event) => setVatNumber(event.target.value)}
                    placeholder="Optional"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payment-terms">Payment terms (days)</Label>
                  <Input
                    id="payment-terms"
                    type="number"
                    min={0}
                    value={paymentTermsDays}
                    onChange={(event) => setPaymentTermsDays(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-medium text-red-800">
                      Unable to create company
                    </p>
                    <p className="mt-1 text-sm text-red-700">{error}</p>
                  </div>
                )}

                {success && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-medium text-emerald-800">
                      {success}
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Creating..." : "Create company"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
