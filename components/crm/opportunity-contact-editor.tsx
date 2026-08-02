"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CompanyContactSelect } from "@/components/crm/company-contact-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QuoteContactDisplay } from "@/lib/crm/quote-contact-display";

type CompanyOption = {
  id: string;
  company_name: string;
};

type OpportunityContactEditorProps = {
  opportunityId: string;
  companyId: string;
  companies: CompanyOption[];
  contact: QuoteContactDisplay | null;
  editable?: boolean;
};

export function OpportunityContactEditor({
  opportunityId,
  companyId,
  companies,
  contact,
  editable = true,
}: OpportunityContactEditorProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [contactId, setContactId] = useState(contact?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/crm/opportunities/${opportunityId}/contact`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId }),
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update contact.");
      }

      setIsEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update contact."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="portal-surface">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Contact</CardTitle>
        {editable && !isEditing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setContactId(contact?.id ?? "");
              setIsEditing(true);
            }}
          >
            {contact ? "Change contact" : "Add contact to opportunity"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!contact ? (
          <p className="text-sm font-medium text-amber-700">No contact linked</p>
        ) : null}

        {!isEditing ? (
          contact ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{contact.full_name}</p>
              {contact.job_title ? (
                <p className="text-muted-foreground">{contact.job_title}</p>
              ) : null}
              {contact.email ? (
                <p className="text-muted-foreground">{contact.email}</p>
              ) : null}
              <p className="text-muted-foreground">{contact.company_name}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add a contact before creating quotes for this opportunity.
            </p>
          )
        ) : (
          <>
            <CompanyContactSelect
              companyId={companyId}
              value={contactId}
              onChange={setContactId}
              companies={companies}
              required
            />
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSubmitting || !contactId}
              >
                {isSubmitting ? "Saving…" : "Save contact"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setContactId(contact?.id ?? "");
                  setIsEditing(false);
                  setError("");
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
