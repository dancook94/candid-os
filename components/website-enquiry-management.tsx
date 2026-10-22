"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { CompanyContactSelect } from "@/components/crm/company-contact-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAYMENT_TERMS_MAX_DAYS, PAYMENT_TERMS_MIN_DAYS } from "@/lib/payment-terms";

type CompanyOption = {
  id: string;
  company_name: string;
};

type WebsiteEnquiryManagementProps = {
  quoteRequestId: string;
  companyId: string | null;
  linkedCompanyName: string | null;
  canChangeCompany: boolean;
  companies: CompanyOption[];
  prefilledCompanyName: string;
  prefilledEmail: string;
  prefilledPhone: string;
  prefilledContactName: string;
  defaultPaymentTermsDays: number;
  confirmedContact: { id: string; fullName: string; email: string | null } | null;
  hasOpportunity: boolean;
  hasQuote: boolean;
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    error?: string;
    companyId?: string;
    contactId?: string;
    existingCompanyId?: string;
    duplicateContactId?: string;
  };

  return { response, payload };
}

export function WebsiteEnquiryManagement({
  quoteRequestId,
  companyId,
  linkedCompanyName,
  canChangeCompany,
  companies,
  prefilledCompanyName,
  prefilledEmail,
  prefilledPhone,
  prefilledContactName,
  defaultPaymentTermsDays,
  confirmedContact,
  hasOpportunity,
  hasQuote,
}: WebsiteEnquiryManagementProps) {
  const router = useRouter();
  const [companyQuery, setCompanyQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [confirmCompany, setConfirmCompany] = useState(false);
  const [companyName, setCompanyName] = useState(prefilledCompanyName);
  const [tradingName, setTradingName] = useState("");
  const [accountsEmail, setAccountsEmail] = useState(prefilledEmail);
  const [companyPhone, setCompanyPhone] = useState(prefilledPhone);
  const [vatNumber, setVatNumber] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(defaultPaymentTermsDays));
  const [confirmCreateCompany, setConfirmCreateCompany] = useState(false);
  const [contactId, setContactId] = useState(confirmedContact?.id ?? "");
  const [confirmContact, setConfirmContact] = useState(false);
  const [newContactName, setNewContactName] = useState(prefilledContactName);
  const [newContactEmail, setNewContactEmail] = useState(prefilledEmail);
  const [newContactPhone, setNewContactPhone] = useState(prefilledPhone);
  const [confirmCreateContact, setConfirmCreateContact] = useState(false);
  const [existingCompanyId, setExistingCompanyId] = useState("");
  const [duplicateContactId, setDuplicateContactId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  const visibleCompanies = companies
    .filter((company) =>
      company.company_name.toLowerCase().includes(companyQuery.trim().toLowerCase())
    )
    .slice(0, 50);

  function begin(action: string) {
    setError("");
    setMessage("");
    setPending(action);
  }

  function finish(nextError: string, nextMessage = "") {
    setPending("");
    setError(nextError);
    setMessage(nextMessage);

    if (!nextError) {
      router.refresh();
    }
  }

  async function linkCompany(targetCompanyId: string) {
    begin("link-company");
    const { response, payload } = await postJson(
      `/api/admin/quote-requests/${quoteRequestId}/link-company`,
      { companyId: targetCompanyId, confirmed: true }
    );
    finish(response.ok ? "" : payload.error ?? "The company could not be linked.", response.ok ? "Company linked." : "");
  }

  async function handleLinkCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCompanyId || !confirmCompany) {
      setError("Choose a company and confirm the link.");
      return;
    }

    await linkCompany(selectedCompanyId);
  }

  async function handleCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!confirmCreateCompany) {
      setError("Confirm the company details before creating it.");
      return;
    }

    begin("create-company");
    setExistingCompanyId("");
    const { response, payload } = await postJson(
      `/api/admin/quote-requests/${quoteRequestId}/company`,
      {
        companyName,
        tradingName,
        accountsEmail,
        phone: companyPhone,
        vatNumber,
        paymentTermsDays: Number.parseInt(paymentTermsDays, 10),
        confirmed: true,
      }
    );

    if (!response.ok) {
      const canLinkExisting =
        Boolean(payload.companyId) ||
        (Boolean(payload.existingCompanyId) && payload.error?.includes("Link that company"));
      setExistingCompanyId(
        canLinkExisting ? payload.companyId ?? payload.existingCompanyId ?? "" : ""
      );
      finish(payload.error ?? "The company could not be created.");
      return;
    }

    finish("", "Company created and linked.");
  }

  async function handleConfirmContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!contactId || !confirmContact) {
      setError("Choose a contact and confirm the selection.");
      return;
    }

    begin("confirm-contact");
    const { response, payload } = await postJson(
      `/api/admin/quote-requests/${quoteRequestId}/contact`,
      { contactId, confirmed: true }
    );
    finish(response.ok ? "" : payload.error ?? "The contact could not be saved.", response.ok ? "Contact confirmed." : "");
  }

  async function handleCreateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!confirmCreateContact) {
      setError("Confirm the contact details before creating them.");
      return;
    }

    begin("create-contact");
    setDuplicateContactId("");
    const { response, payload } = await postJson(
      `/api/admin/quote-requests/${quoteRequestId}/contact/create`,
      {
        fullName: newContactName,
        email: newContactEmail,
        phone: newContactPhone,
        confirmed: true,
      }
    );

    if (!response.ok) {
      setDuplicateContactId(payload.duplicateContactId ?? "");
      finish(payload.error ?? "The contact could not be created.");
      return;
    }

    if (payload.contactId) {
      setContactId(payload.contactId);
    }

    finish("", "Contact created.");
  }

  async function handleCreateOpportunity() {
    if (!contactId) {
      setError("Choose a contact before creating an opportunity.");
      return;
    }

    begin("opportunity");
    const { response, payload } = await postJson(
      `/api/crm/quote-requests/${quoteRequestId}/ensure-opportunity`,
      { contactId }
    );
    finish(
      response.ok ? "" : payload.error ?? "The opportunity could not be created.",
      response.ok ? "Opportunity created." : ""
    );
  }

  return (
    <Card className="mt-6 portal-surface">
      <CardHeader className="border-b border-border">
        <CardTitle>Website enquiry</CardTitle>
        <CardDescription>
          Link a company and contact, then continue with the existing opportunity and quotation workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        {companyId ? (
          <p className="text-sm text-neutral-950">
            Linked company: <span className="font-medium">{linkedCompanyName || "Unknown company"}</span>
          </p>
        ) : (
          <p className="text-sm font-medium text-neutral-950">Company: Unlinked</p>
        )}

        {canChangeCompany ? (
          <div className="grid gap-8 lg:grid-cols-2">
            <form className="space-y-4" onSubmit={handleLinkCompany}>
              <h3 className="text-sm font-semibold text-neutral-950">Link an existing company</h3>
              <div className="space-y-2">
                <Label htmlFor="company-search">Search companies</Label>
                <Input
                  id="company-search"
                  value={companyQuery}
                  onChange={(event) => setCompanyQuery(event.target.value)}
                  placeholder="Type a company name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="existing-company">Company</Label>
                <select
                  id="existing-company"
                  value={selectedCompanyId}
                  onChange={(event) => setSelectedCompanyId(event.target.value)}
                  className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm"
                >
                  <option value="">Select a company…</option>
                  {visibleCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={confirmCompany}
                  onChange={(event) => setConfirmCompany(event.target.checked)}
                  className="mt-1"
                />
                Link this enquiry to the selected company
              </label>
              <Button type="submit" disabled={pending !== "" || !selectedCompanyId || !confirmCompany}>
                {pending === "link-company" ? "Linking..." : "Link company"}
              </Button>
            </form>

            <form className="space-y-4" onSubmit={handleCreateCompany}>
              <h3 className="text-sm font-semibold text-neutral-950">Create a company</h3>
              <div className="space-y-2">
                <Label htmlFor="new-company-name">Legal company name</Label>
                <Input id="new-company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-trading-name">Trading name</Label>
                <Input id="new-trading-name" value={tradingName} onChange={(event) => setTradingName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-accounts-email">Accounts email</Label>
                <Input id="new-accounts-email" type="email" value={accountsEmail} onChange={(event) => setAccountsEmail(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-company-phone">Phone</Label>
                <Input id="new-company-phone" type="tel" value={companyPhone} onChange={(event) => setCompanyPhone(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-vat-number">VAT number</Label>
                <Input id="new-vat-number" value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-payment-terms">Payment terms (days)</Label>
                <Input
                  id="new-payment-terms"
                  type="number"
                  min={PAYMENT_TERMS_MIN_DAYS}
                  max={PAYMENT_TERMS_MAX_DAYS}
                  step={1}
                  value={paymentTermsDays}
                  onChange={(event) => setPaymentTermsDays(event.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={confirmCreateCompany}
                  onChange={(event) => setConfirmCreateCompany(event.target.checked)}
                  className="mt-1"
                />
                Create this company and link it to the enquiry
              </label>
              <Button type="submit" disabled={pending !== "" || !confirmCreateCompany}>
                {pending === "create-company" ? "Creating..." : "Create and link company"}
              </Button>
              {existingCompanyId ? (
                <Button type="button" variant="outline" onClick={() => linkCompany(existingCompanyId)} disabled={pending !== ""}>
                  Link the existing company
                </Button>
              ) : null}
            </form>
          </div>
        ) : null}

        {companyId && !hasQuote ? (
          <div className="grid gap-8 lg:grid-cols-2">
            <form className="space-y-4" onSubmit={handleConfirmContact}>
              <h3 className="text-sm font-semibold text-neutral-950">Choose an existing contact</h3>
              <CompanyContactSelect
                companyId={companyId}
                value={contactId}
                onChange={setContactId}
                companies={[{ id: companyId, company_name: linkedCompanyName || "Linked company" }]}
                required={false}
                allowCreate={false}
              />
              <label className="flex items-start gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={confirmContact}
                  onChange={(event) => setConfirmContact(event.target.checked)}
                  className="mt-1"
                />
                Use this contact for the opportunity and quotation
              </label>
              <Button type="submit" disabled={pending !== "" || !contactId || !confirmContact}>
                {pending === "confirm-contact" ? "Saving..." : "Confirm contact"}
              </Button>
              {duplicateContactId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setContactId(duplicateContactId);
                    setConfirmContact(true);
                  }}
                >
                  Use the existing contact
                </Button>
              ) : null}
            </form>

            <form className="space-y-4" onSubmit={handleCreateContact}>
              <h3 className="text-sm font-semibold text-neutral-950">Create a contact</h3>
              <p className="text-sm text-neutral-600">This does not create a portal account.</p>
              <div className="space-y-2">
                <Label htmlFor="new-contact-name">Full name</Label>
                <Input id="new-contact-name" value={newContactName} onChange={(event) => setNewContactName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-contact-email">Email</Label>
                <Input id="new-contact-email" type="email" value={newContactEmail} onChange={(event) => setNewContactEmail(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-contact-phone">Phone</Label>
                <Input id="new-contact-phone" type="tel" value={newContactPhone} onChange={(event) => setNewContactPhone(event.target.value)} />
              </div>
              <label className="flex items-start gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={confirmCreateContact}
                  onChange={(event) => setConfirmCreateContact(event.target.checked)}
                  className="mt-1"
                />
                Create this contact for the linked company
              </label>
              <Button type="submit" disabled={pending !== "" || !confirmCreateContact}>
                {pending === "create-contact" ? "Creating..." : "Create contact"}
              </Button>
            </form>
          </div>
        ) : null}

        {confirmedContact ? (
          <p className="text-sm text-neutral-950">
            Confirmed contact: <span className="font-medium">{confirmedContact.fullName}</span>
            {confirmedContact.email ? ` · ${confirmedContact.email}` : ""}
          </p>
        ) : null}

        {companyId && !hasOpportunity && !hasQuote ? (
          <Button type="button" onClick={handleCreateOpportunity} disabled={pending !== "" || !contactId}>
            {pending === "opportunity" ? "Creating..." : "Create opportunity"}
          </Button>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
