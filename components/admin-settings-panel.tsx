"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
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
import type { AppSettings, EmailConfigStatus } from "@/lib/app-settings";
import { formatRoleLabel } from "@/lib/staff-roles";
import {
  parsePaymentTermsDays,
  PAYMENT_TERMS_MAX_DAYS,
  PAYMENT_TERMS_MIN_DAYS,
} from "@/lib/payment-terms";
import { cn } from "@/lib/utils";

type SettingsTab =
  | "company"
  | "quotes"
  | "branding"
  | "email"
  | "customers"
  | "security";

type AdminSettingsPanelProps = {
  settings: AppSettings;
  canEdit: boolean;
  userRole: string;
  emailConfig: EmailConfigStatus;
  settingsLoadError: string | null;
};

const tabs: { id: SettingsTab; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "quotes", label: "Quote defaults" },
  { id: "branding", label: "Branding" },
  { id: "email", label: "Email" },
  { id: "customers", label: "Customer defaults" },
  { id: "security", label: "Security" },
];

function ConfigStatus({ configured }: { configured: boolean }) {
  return (
    <StatusBadge
      status={configured ? "approved" : "pending"}
      label={configured ? "Configured" : "Not configured"}
    />
  );
}

function SectionMessage({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{error}</p>
        </div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">{success}</p>
        </div>
      ) : null}
    </>
  );
}

export function AdminSettingsPanel({
  settings,
  canEdit,
  userRole,
  emailConfig,
  settingsLoadError,
}: AdminSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("company");

  const [companyForm, setCompanyForm] = useState({
    companyName: settings.company_name,
    addressLine1: settings.address_line_1 ?? "",
    addressLine2: settings.address_line_2 ?? "",
    addressCity: settings.address_city ?? "",
    addressPostcode: settings.address_postcode ?? "",
    telephone: settings.telephone ?? "",
    website: settings.website ?? "",
    companyNumber: settings.company_number ?? "",
    vatNumber: settings.vat_number ?? "",
    accountsEmail: settings.accounts_email ?? "",
    quoteEmailSenderName: settings.quote_email_sender_name ?? "",
    quoteEmailSenderAddress: settings.quote_email_sender_address ?? "",
  });

  const [quoteForm, setQuoteForm] = useState({
    defaultPaymentTermsDays: String(settings.default_payment_terms_days),
    defaultQuoteExpiryDays: String(settings.default_quote_expiry_days),
    defaultVatRate: String(settings.default_vat_rate),
    defaultIntroduction: settings.default_introduction ?? "",
    defaultCustomerNotes: settings.default_customer_notes ?? "",
    quoteNumberPrefix: settings.quote_number_prefix,
    showProductImagesByDefault: settings.show_product_images_by_default,
  });

  const [customerForm, setCustomerForm] = useState({
    defaultCompanyPaymentTermsDays: String(
      settings.default_company_payment_terms_days
    ),
    defaultRegistrationAccountStatus: settings.default_registration_account_status,
    defaultDeadlineStatus: settings.default_deadline_status,
  });

  const [companyState, setCompanyState] = useState({ loading: false, error: "", success: "" });
  const [quoteState, setQuoteState] = useState({ loading: false, error: "", success: "" });
  const [customerState, setCustomerState] = useState({ loading: false, error: "", success: "" });

  async function saveSection(
    endpoint: string,
    payload: Record<string, unknown>,
    setState: typeof setCompanyState
  ) {
    setState({ loading: true, error: "", success: "" });

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setState({
          loading: false,
          error: body.error ?? "Unable to save settings.",
          success: "",
        });
        return;
      }

      setState({
        loading: false,
        error: "",
        success: "Settings saved successfully.",
      });
    } catch {
      setState({
        loading: false,
        error: "Unable to save settings.",
        success: "",
      });
    }
  }

  async function handleCompanySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSection("/api/admin/settings/company", companyForm, setCompanyState);
  }

  async function handleQuoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const defaultPaymentTermsDays = parsePaymentTermsDays(
      quoteForm.defaultPaymentTermsDays
    );

    if (defaultPaymentTermsDays === null) {
      setQuoteState({
        loading: false,
        error: `Fallback payment terms must be a whole number between ${PAYMENT_TERMS_MIN_DAYS} and ${PAYMENT_TERMS_MAX_DAYS} days.`,
        success: "",
      });
      return;
    }

    await saveSection(
      "/api/admin/settings/quotes",
      {
        defaultPaymentTermsDays,
        defaultQuoteExpiryDays: Number.parseInt(quoteForm.defaultQuoteExpiryDays, 10),
        defaultVatRate: Number.parseFloat(quoteForm.defaultVatRate),
        defaultIntroduction: quoteForm.defaultIntroduction,
        defaultCustomerNotes: quoteForm.defaultCustomerNotes,
        quoteNumberPrefix: quoteForm.quoteNumberPrefix,
        showProductImagesByDefault: quoteForm.showProductImagesByDefault,
      },
      setQuoteState
    );
  }

  async function handleCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const defaultCompanyPaymentTermsDays = parsePaymentTermsDays(
      customerForm.defaultCompanyPaymentTermsDays
    );

    if (defaultCompanyPaymentTermsDays === null) {
      setCustomerState({
        loading: false,
        error: `New customer payment terms must be a whole number between ${PAYMENT_TERMS_MIN_DAYS} and ${PAYMENT_TERMS_MAX_DAYS} days.`,
        success: "",
      });
      return;
    }

    await saveSection(
      "/api/admin/settings/customer-defaults",
      {
        defaultCompanyPaymentTermsDays,
        defaultRegistrationAccountStatus:
          customerForm.defaultRegistrationAccountStatus,
        defaultDeadlineStatus: customerForm.defaultDeadlineStatus,
      },
      setCustomerState
    );
  }

  return (
    <div className="space-y-6">
      {settingsLoadError ? (
        <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-amber-900">
              Settings table not available
            </p>
            <p className="mt-2 text-sm text-amber-800">
              {settingsLoadError}. Apply the proposed migration in{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
                docs/proposed-app-settings-migration.sql
              </code>{" "}
              before saving. Displaying fallback values for now.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!canEdit ? (
        <Card className="rounded-2xl border-border bg-muted/30 shadow-sm ring-0">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              You have read-only access. Only super admins can update settings.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-muted text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "company" ? (
        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Company details</CardTitle>
            <CardDescription>
              Candid business details shown on quotations and customer communications.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={handleCompanySubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="company-name">Company name</Label>
                  <Input
                    id="company-name"
                    value={companyForm.companyName}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        companyName: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address-line-1">Address line 1</Label>
                  <Input
                    id="address-line-1"
                    value={companyForm.addressLine1}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        addressLine1: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address-line-2">Address line 2</Label>
                  <Input
                    id="address-line-2"
                    value={companyForm.addressLine2}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        addressLine2: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address-city">City</Label>
                  <Input
                    id="address-city"
                    value={companyForm.addressCity}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        addressCity: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address-postcode">Postcode</Label>
                  <Input
                    id="address-postcode"
                    value={companyForm.addressPostcode}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        addressPostcode: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telephone">Telephone</Label>
                  <Input
                    id="telephone"
                    value={companyForm.telephone}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        telephone: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={companyForm.website}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        website: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-number">Company number</Label>
                  <Input
                    id="company-number"
                    value={companyForm.companyNumber}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        companyNumber: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vat-number">VAT number</Label>
                  <Input
                    id="vat-number"
                    value={companyForm.vatNumber}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        vatNumber: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accounts-email">Accounts email</Label>
                  <Input
                    id="accounts-email"
                    type="email"
                    value={companyForm.accountsEmail}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        accountsEmail: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quote-sender-name">Quote email sender name</Label>
                  <Input
                    id="quote-sender-name"
                    value={companyForm.quoteEmailSenderName}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        quoteEmailSenderName: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="quote-sender-address">Quote email sender address</Label>
                  <Input
                    id="quote-sender-address"
                    type="email"
                    value={companyForm.quoteEmailSenderAddress}
                    onChange={(event) =>
                      setCompanyForm((current) => ({
                        ...current,
                        quoteEmailSenderAddress: event.target.value,
                      }))
                    }
                    disabled={!canEdit || companyState.loading}
                  />
                </div>
              </div>

              <SectionMessage error={companyState.error} success={companyState.success} />

              {canEdit ? (
                <Button type="submit" disabled={companyState.loading}>
                  {companyState.loading ? "Saving..." : "Save company details"}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "quotes" ? (
        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Quote defaults</CardTitle>
            <CardDescription>
              Applied when creating new quotes. Existing quotes are not changed.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={handleQuoteSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="default-payment-terms">
                    Fallback payment terms (days)
                  </Label>
                  <Input
                    id="default-payment-terms"
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={quoteForm.defaultPaymentTermsDays}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        defaultPaymentTermsDays: event.target.value,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Used only when the selected customer has no payment terms set.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default-expiry-days">Default quote expiry (days)</Label>
                  <Input
                    id="default-expiry-days"
                    type="number"
                    min={0}
                    max={365}
                    value={quoteForm.defaultQuoteExpiryDays}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        defaultQuoteExpiryDays: event.target.value,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default-vat-rate">Default VAT rate</Label>
                  <Input
                    id="default-vat-rate"
                    type="number"
                    min={0}
                    max={1}
                    step={0.0001}
                    value={quoteForm.defaultVatRate}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        defaultVatRate: event.target.value,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quote-prefix">Quote-number prefix</Label>
                  <Input
                    id="quote-prefix"
                    value={quoteForm.quoteNumberPrefix}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        quoteNumberPrefix: event.target.value,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="default-introduction">Default introduction</Label>
                  <textarea
                    id="default-introduction"
                    value={quoteForm.defaultIntroduction}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        defaultIntroduction: event.target.value,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    rows={4}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="default-customer-notes">Default customer notes</Label>
                  <textarea
                    id="default-customer-notes"
                    value={quoteForm.defaultCustomerNotes}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        defaultCustomerNotes: event.target.value,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    rows={4}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  />
                </div>
                <div className="flex items-center gap-3 md:col-span-2">
                  <input
                    id="show-product-images"
                    type="checkbox"
                    checked={quoteForm.showProductImagesByDefault}
                    onChange={(event) =>
                      setQuoteForm((current) => ({
                        ...current,
                        showProductImagesByDefault: event.target.checked,
                      }))
                    }
                    disabled={!canEdit || quoteState.loading}
                    className="h-4 w-4 rounded border-border"
                  />
                  <Label htmlFor="show-product-images">
                    Show product images by default
                  </Label>
                </div>
              </div>

              <SectionMessage error={quoteState.error} success={quoteState.success} />

              {canEdit ? (
                <Button type="submit" disabled={quoteState.loading}>
                  {quoteState.loading ? "Saving..." : "Save quote defaults"}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "branding" ? (
        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Branding</CardTitle>
            <CardDescription>
              Preview the current Candid OS brand assets. Logo replacement is not enabled yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="rounded-2xl border border-border bg-muted/20 p-6">
              <p className="text-sm font-medium text-foreground">Current logo</p>
              <div className="mt-4 flex items-center justify-center rounded-xl bg-background p-8">
                <Image
                  src="/LOGO_YELLOW.svg"
                  alt="Candid Creative logo"
                  width={220}
                  height={108}
                  className="h-auto w-[min(220px,70vw)]"
                />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Source: /public/LOGO_YELLOW.svg
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-muted/20 p-6">
              <p className="text-sm font-medium text-foreground">Accent colour</p>
              <div className="mt-4 flex items-center gap-4">
                <div
                  className="h-12 w-12 rounded-xl ring-1 ring-border"
                  style={{ backgroundColor: settings.accent_colour }}
                  aria-hidden
                />
                <div>
                  <p className="font-mono text-sm text-foreground">
                    {settings.accent_colour}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Used across the portal highlight styling.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "email" ? (
        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Email settings</CardTitle>
            <CardDescription>
              Environment configuration for quotation email delivery. Secret values are never shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-foreground">RESEND_API_KEY</p>
                <div className="mt-2">
                  <ConfigStatus configured={emailConfig.resendConfigured} />
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-foreground">NEXT_PUBLIC_APP_URL</p>
                <div className="mt-2">
                  <ConfigStatus configured={emailConfig.appUrlConfigured} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Quotation sender address</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {emailConfig.senderAddress}
              </p>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Reply-to address</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {emailConfig.replyToAddress}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "customers" ? (
        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Customer defaults</CardTitle>
            <CardDescription>
              Defaults for new companies, registrations and quote requests only.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={handleCustomerSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="default-company-payment-terms">
                    New customer payment terms (days)
                  </Label>
                  <Input
                    id="default-company-payment-terms"
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={customerForm.defaultCompanyPaymentTermsDays}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        defaultCompanyPaymentTermsDays: event.target.value,
                      }))
                    }
                    disabled={!canEdit || customerState.loading}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Applied when a new customer company is created.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default-registration-status">
                    Default account status for registrations
                  </Label>
                  <select
                    id="default-registration-status"
                    value={customerForm.defaultRegistrationAccountStatus}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        defaultRegistrationAccountStatus: event.target.value,
                      }))
                    }
                    disabled={!canEdit || customerState.loading}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default-deadline-status">Default deadline status</Label>
                  <select
                    id="default-deadline-status"
                    value={customerForm.defaultDeadlineStatus}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        defaultDeadlineStatus: event.target.value,
                      }))
                    }
                    disabled={!canEdit || customerState.loading}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                  </select>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Registration account status requires a database trigger update before it
                affects self-service sign-ups. Existing customers and quotes are never
                overwritten.
              </p>

              <SectionMessage error={customerState.error} success={customerState.success} />

              {canEdit ? (
                <Button type="submit" disabled={customerState.loading}>
                  {customerState.loading ? "Saving..." : "Save customer defaults"}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "security" ? (
        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Security</CardTitle>
            <CardDescription>
              Access control overview for your Candid OS administrator account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Current role</p>
              <div className="mt-2">
                <StatusBadge status="sent" label={formatRoleLabel(userRole)} />
              </div>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">
              Staff access, invitations, role changes and account deactivation are managed
              from the Staff page. Service-role keys and secret credentials are never shown
              here.
            </p>

            {userRole === "super_admin" ? (
              <Link
                href="/admin/staff"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                Manage staff
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
