"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ContactFormDialog } from "@/components/crm/contact-form-dialog";
import { ResendAccountReadyButton } from "@/components/resend-account-ready-button";
import { Button } from "@/components/ui/button";
import { isCustomerPortalInviteAllowedPublic } from "@/lib/communications/portal-invite-allowlist";
import type { ContactListRow } from "@/lib/crm/contacts";

type ContactDetailActionsProps = {
  contact: ContactListRow;
  resendAccountReadyProfileId?: string | null;
  showResendAccountReadyEmail?: boolean;
};

export function ContactDetailActions({
  contact,
  resendAccountReadyProfileId,
  showResendAccountReadyEmail = false,
}: ContactDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState("");
  const portalInviteAllowed = isCustomerPortalInviteAllowedPublic(contact.email);

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
          disabled={isInviting || !contact.email || !portalInviteAllowed}
          onClick={handleInvite}
        >
          {isInviting ? "Sending..." : "Invite to portal"}
        </Button>
      ) : null}

      {contact.portal_status === "invitation_sent" ||
      contact.portal_status === "pending" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isInviting || !portalInviteAllowed}
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

      {showResendAccountReadyEmail && resendAccountReadyProfileId ? (
        <ResendAccountReadyButton profileId={resendAccountReadyProfileId} />
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditOpen(true)}
      >
        Edit contact
      </Button>

      {!portalInviteAllowed && contact.email ? (
        <p className="w-full text-sm text-muted-foreground">
          Portal invitations to external addresses are blocked in test communication mode unless the
          email is on the Test invite allowlist.
        </p>
      ) : null}

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
