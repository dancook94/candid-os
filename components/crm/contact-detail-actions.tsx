"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ContactFormDialog } from "@/components/crm/contact-form-dialog";
import { Button } from "@/components/ui/button";
import type { ContactListRow } from "@/lib/crm/contacts";

type ContactDetailActionsProps = {
  contact: ContactListRow;
};

export function ContactDetailActions({ contact }: ContactDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState("");

  async function handleInvite() {
    setIsInviting(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/contacts/${contact.id}/invite`, {
        method: "POST",
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to send invitation.");
        return;
      }

      router.refresh();
    } catch {
      setError("Unable to send invitation.");
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <>
      {contact.portal_status === "not_invited" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isInviting || !contact.email}
          onClick={handleInvite}
        >
          {isInviting ? "Sending..." : "Invite to portal"}
        </Button>
      ) : null}

      {contact.portal_status === "pending" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isInviting}
          onClick={handleInvite}
        >
          {isInviting ? "Sending..." : "Resend invitation"}
        </Button>
      ) : null}

      {contact.portal_status === "approved" ? (
        <Link href={`/admin/customers/${contact.id}#portal-user`}>
          <Button type="button" variant="outline" size="sm">
            View portal user
          </Button>
        </Link>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditOpen(true)}
      >
        Edit contact
      </Button>

      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}

      <ContactFormDialog
        companies={[
          { id: contact.company_id, company_name: contact.company_name },
        ]}
        mode="edit"
        contact={contact}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </>
  );
}
