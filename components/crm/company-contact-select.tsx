"use client";

import { useEffect, useState } from "react";

import { NewContactButton } from "@/components/crm/contact-form-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  formatCompanyContactLabel,
  type CompanyContactOption,
} from "@/lib/crm/company-contact-options";

type CompanyOption = {
  id: string;
  company_name: string;
};

type CompanyContactSelectProps = {
  companyId: string;
  value: string;
  onChange: (contactId: string) => void;
  companies: CompanyOption[];
  required?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  lockContact?: boolean;
  onContactsLoaded?: (contacts: CompanyContactOption[]) => void;
};

export function CompanyContactSelect({
  companyId,
  value,
  onChange,
  companies,
  required = true,
  disabled = false,
  id = "contact",
  label = "Contact",
  lockContact = false,
  onContactsLoaded,
}: CompanyContactSelectProps) {
  const [contacts, setContacts] = useState<CompanyContactOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!companyId) {
      setContacts([]);
      setLoadError("");
      onContactsLoaded?.([]);
      return;
    }

    let cancelled = false;

    async function loadContacts() {
      setIsLoading(true);
      setLoadError("");

      try {
        const response = await fetch(
          `/api/crm/companies/${encodeURIComponent(companyId)}/contacts`
        );
        const payload = (await response.json()) as {
          contacts?: CompanyContactOption[];
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setContacts([]);
          setLoadError(payload.error ?? "Unable to load contacts.");
          onContactsLoaded?.([]);
          return;
        }

        const nextContacts = payload.contacts ?? [];
        setContacts(nextContacts);
        onContactsLoaded?.(nextContacts);

        if (
          value &&
          !nextContacts.some((contact) => contact.id === value)
        ) {
          onChange("");
        }
      } catch {
        if (!cancelled) {
          setContacts([]);
          setLoadError("Unable to load contacts.");
          onContactsLoaded?.([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadContacts();

    return () => {
      cancelled = true;
    };
  }, [companyId, onChange, onContactsLoaded, value]);

  const selectedCompany = companies.find((company) => company.id === companyId);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      {!companyId ? (
        <p className="text-sm text-muted-foreground">
          Select a company first to choose a contact.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading contacts…</p>
      ) : loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : contacts.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">
            This company has no contacts yet.
          </p>
          {!disabled && !lockContact ? (
            <NewContactButton
              companies={companies}
              defaultCompanyId={companyId}
              lockCompany
              label="Add contact"
            />
          ) : null}
        </div>
      ) : (
        <>
          <Select
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled || lockContact}
            required={required}
          >
            <option value="">Select contact…</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {formatCompanyContactLabel(contact)}
              </option>
            ))}
          </Select>

          {!disabled && !lockContact ? (
            <div className="flex flex-wrap items-center gap-2">
              <NewContactButton
                companies={companies}
                defaultCompanyId={companyId}
                lockCompany
                label="Add contact"
              />
              {selectedCompany ? (
                <p className="text-xs text-muted-foreground">
                  Contacts are limited to {selectedCompany.company_name}.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
