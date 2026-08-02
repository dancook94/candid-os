"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ContactFormDialog } from "@/components/crm/contact-form-dialog";
import { ContactPortalStatusBadge } from "@/components/crm/contact-portal-status-badge";
import { Button } from "@/components/ui/button";
import type { ContactListRow } from "@/lib/crm/contacts";

type CompanyOption = {
  id: string;
  company_name: string;
};

type ContactsTableProps = {
  contacts: ContactListRow[];
  companies: CompanyOption[];
  showCompanyColumn?: boolean;
  showQuickActions?: boolean;
};

export function ContactsTable({
  contacts,
  companies,
  showCompanyColumn = true,
  showQuickActions = false,
}: ContactsTableProps) {
  const router = useRouter();
  const [editingContact, setEditingContact] = useState<ContactListRow | null>(
    null
  );
  const [actionContactId, setActionContactId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleInvite(contactId: string) {
    setActionContactId(contactId);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/admin/contacts/${contactId}/invite`,
        { method: "POST" }
      );

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setActionError(payload.error ?? "Unable to send invitation.");
        return;
      }

      router.refresh();
    } catch {
      setActionError("Unable to send invitation.");
    } finally {
      setActionContactId(null);
    }
  }

  return (
    <>
      {actionError ? (
        <p className="mb-4 text-sm text-red-600">{actionError}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="portal-table">
          <thead>
            <tr>
              <th>Name</th>
              {showCompanyColumn ? <th>Company</th> : null}
              <th>Job title</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Portal status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {contacts.map((contact) => {
              const isBusy = actionContactId === contact.id;

              return (
                <tr key={contact.id}>
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/admin/customers/${contact.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {contact.full_name}
                      {contact.is_primary ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Primary
                        </span>
                      ) : null}
                    </Link>
                  </td>

                  {showCompanyColumn ? (
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/companies/${contact.company_id}`}
                        className="text-foreground hover:underline"
                      >
                        {contact.company_name}
                      </Link>
                    </td>
                  ) : null}

                  <td className="px-4 py-3.5 text-muted-foreground">
                    {contact.job_title || "—"}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {contact.email || "—"}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {contact.phone || "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    <ContactPortalStatusBadge status={contact.portal_status} />
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-2">
                      {contact.portal_status === "not_invited" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isBusy || !contact.email}
                          onClick={() => handleInvite(contact.id)}
                        >
                          {isBusy ? "Sending..." : "Invite to portal"}
                        </Button>
                      ) : null}

                      {contact.portal_status === "invitation_sent" ||
                      contact.portal_status === "pending" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleInvite(contact.id)}
                        >
                          {isBusy ? "Sending..." : "Resend invitation"}
                        </Button>
                      ) : null}

                      {contact.portal_status === "approved" &&
                      contact.profile_id ? (
                        <Link href={`/admin/customers/${contact.id}`}>
                          <Button type="button" variant="outline" size="sm">
                            View portal user
                          </Button>
                        </Link>
                      ) : null}

                      {showQuickActions ? (
                        <>
                          <Link
                            href={`/admin/opportunities/new?companyId=${encodeURIComponent(contact.company_id)}&contactId=${encodeURIComponent(contact.id)}`}
                          >
                            <Button type="button" variant="outline" size="sm">
                              New opportunity
                            </Button>
                          </Link>
                          <Link
                            href={`/admin/quotes/new?companyId=${encodeURIComponent(contact.company_id)}&contactId=${encodeURIComponent(contact.id)}`}
                          >
                            <Button type="button" variant="outline" size="sm">
                              New quote
                            </Button>
                          </Link>
                          <Link
                            href={`/admin/tasks/new?companyId=${encodeURIComponent(contact.company_id)}&contactId=${encodeURIComponent(contact.id)}`}
                          >
                            <Button type="button" variant="outline" size="sm">
                              Add task
                            </Button>
                          </Link>
                        </>
                      ) : null}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingContact(contact)}
                      >
                        Edit contact
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingContact ? (
        <ContactFormDialog
          companies={companies}
          mode="edit"
          contact={editingContact}
          open={Boolean(editingContact)}
          onClose={() => setEditingContact(null)}
        />
      ) : null}
    </>
  );
}
