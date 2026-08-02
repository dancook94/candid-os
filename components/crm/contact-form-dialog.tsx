"use client";

import { FormEvent, useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { ContactListRow } from "@/lib/crm/contacts";

type CompanyOption = {
  id: string;
  company_name: string;
};

type ContactFormDialogProps = {
  companies: CompanyOption[];
  mode: "create" | "edit";
  contact?: ContactListRow;
  defaultCompanyId?: string;
  lockCompany?: boolean;
  open: boolean;
  onClose: () => void;
  triggerLabel?: string;
};

export function ContactFormDialog({
  companies,
  mode,
  contact,
  defaultCompanyId = "",
  lockCompany = false,
  open,
  onClose,
}: ContactFormDialogProps) {
  const router = useRouter();

  const [companyId, setCompanyId] = useState(
    contact?.company_id ?? defaultCompanyId
  );
  const [fullName, setFullName] = useState(contact?.full_name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [jobTitle, setJobTitle] = useState(contact?.job_title ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? false);
  const [isActive, setIsActive] = useState(contact?.is_active ?? true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setCompanyId(contact?.company_id ?? defaultCompanyId);
    setFullName(contact?.full_name ?? "");
    setEmail(contact?.email ?? "");
    setPhone(contact?.phone ?? "");
    setJobTitle(contact?.job_title ?? "");
    setNotes(contact?.notes ?? "");
    setIsPrimary(contact?.is_primary ?? false);
    setIsActive(contact?.is_active ?? true);
    setError("");
    setSuccess("");
  }, [open, contact, defaultCompanyId]);

  function handleClose() {
    if (isSubmitting) {
      return;
    }

    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const trimmedFullName = fullName.trim();

    if (!companyId) {
      setError("Company is required.");
      return;
    }

    if (!trimmedFullName) {
      setError("Full name is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        companyId,
        fullName: trimmedFullName,
        email: email.trim() || null,
        phone: phone.trim() || null,
        jobTitle: jobTitle.trim() || null,
        notes: notes.trim() || null,
        isPrimary,
        isActive,
      };

      const response = await fetch(
        mode === "create"
          ? "/api/admin/contacts"
          : `/api/admin/contacts/${contact?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result = (await response.json()) as {
        error?: string;
        message?: string;
        id?: string;
        duplicateContactId?: string;
      };

      if (!response.ok) {
        setError(result.error ?? "Unable to save contact.");
        return;
      }

      setSuccess(result.message ?? "Contact saved.");
      router.refresh();

      window.setTimeout(() => {
        handleClose();

        if (mode === "create" && result.id) {
          router.push(`/admin/customers/${result.id}`);
        }
      }, 600);
    } catch {
      setError("Unable to save contact.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-neutral-950/40"
        onClick={handleClose}
      />

      <Card className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-neutral-200 shadow-lg ring-0">
        <CardHeader className="border-b border-neutral-200">
          <CardTitle className="text-lg font-semibold text-neutral-950">
            {mode === "create" ? "New contact" : "Edit contact"}
          </CardTitle>
          <CardDescription>
            {mode === "create"
              ? "Add a CRM contact without sending a portal invitation."
              : "Update contact details."}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {lockCompany ? (
              <div className="space-y-2">
                <Label>Company</Label>
                <p className="text-sm text-neutral-700">
                  {companies.find((company) => company.id === companyId)
                    ?.company_name ?? "Selected company"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="contact-company">
                  Company <span className="text-red-600">*</span>
                </Label>
                <select
                  id="contact-company"
                  value={companyId}
                  onChange={(event) => setCompanyId(event.target.value)}
                  disabled={isSubmitting || mode === "edit"}
                  className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
                  required
                >
                  <option value="">Select company</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="contact-full-name">
                Full name <span className="text-red-600">*</span>
              </Label>
              <Input
                id="contact-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-job-title">Job title</Label>
              <Input
                id="contact-job-title"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-notes">Notes</Label>
              <Textarea
                id="contact-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={isSubmitting}
                rows={3}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(event) => setIsPrimary(event.target.checked)}
                disabled={isSubmitting}
                className="rounded border-neutral-300"
              />
              Primary contact
            </label>

            {mode === "edit" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  disabled={isSubmitting}
                  className="rounded border-neutral-300"
                />
                Active
              </label>
            ) : null}

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
                {isSubmitting
                  ? "Saving..."
                  : mode === "create"
                    ? "Create contact"
                    : "Save changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type NewContactButtonProps = {
  companies: CompanyOption[];
  defaultCompanyId?: string;
  lockCompany?: boolean;
  label?: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
};

export function NewContactButton({
  companies,
  defaultCompanyId,
  lockCompany = false,
  label = "New contact",
  variant = "default",
  size = "default",
}: NewContactButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <ContactFormDialog
        companies={companies}
        mode="create"
        defaultCompanyId={defaultCompanyId}
        lockCompany={lockCompany}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
