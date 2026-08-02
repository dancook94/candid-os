import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { NoteComposer } from "@/components/crm/note-composer";
import { NotesList } from "@/components/crm/notes-list";
import { ContactPortalStatusBadge } from "@/components/crm/contact-portal-status-badge";
import { ContactDetailActions } from "@/components/crm/contact-detail-actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchContactById } from "@/lib/crm/contacts";
import { getCrmNotes, getCrmTimeline } from "@/lib/crm/get-crm-timeline";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ContactDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ContactDetailPage({
  params,
}: ContactDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    `/admin/customers/${id}`
  );

  const [{ contact, queryError }, { data: companies }] = await Promise.all([
    fetchContactById(supabase, id),
    supabase
      .from("companies")
      .select("id, company_name")
      .order("company_name"),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdmin = ["super_admin", "admin"].includes(profile.user_role);
  const notesAndActivity =
    contact && user ?
      await Promise.all([
        getCrmNotes(supabase, {
          scope: {
            type: "contact",
            contactId: contact.id,
            companyId: contact.company_id,
          },
          currentUserId: user.id,
          isAdmin,
        }),
        getCrmTimeline(supabase, {
          scope: {
            type: "contact",
            contactId: contact.id,
            companyId: contact.company_id,
          },
          limit: 50,
        }),
      ])
    : null;

  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const isDevelopment = process.env.NODE_ENV === "development";

  if (!contact) {
    if (queryError && queryError !== "Contact not found.") {
      return (
        <AppShell {...shellProps}>
          <div className="mx-auto max-w-4xl">
            <PageHeader
              eyebrow="CRM"
              title="Unable to load contact"
              description="The contact record could not be loaded."
              actions={
                <Link href="/admin/customers">
                  <Button variant="outline">Back to contacts</Button>
                </Link>
              }
            />
            <Card className="portal-surface border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <p className="text-sm font-medium text-red-800">
                  Contact query error
                </p>
                <p className="mt-2 text-sm text-red-700">{queryError}</p>
                {!isDevelopment ? (
                  <p className="mt-2 text-sm text-red-700">
                    Contact details could not be loaded.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </AppShell>
      );
    }

    notFound();
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          eyebrow="CRM"
          title={contact.full_name}
          description={contact.job_title || "Contact details"}
          actions={
            <Link href="/admin/customers">
              <Button variant="outline">Back to contacts</Button>
            </Link>
          }
        />

        <div className="mb-6 flex flex-wrap gap-2">
          <ContactDetailActions contact={contact} />
        </div>

        <div className="grid gap-6">
          <Card className="portal-surface overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg font-semibold">Contact</CardTitle>
              <CardDescription>
                CRM record for {contact.company_name}.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="portal-field-label">Company</dt>
                  <dd className="portal-detail-value">
                    <Link
                      href={`/admin/companies/${contact.company_id}`}
                      className="hover:underline"
                    >
                      {contact.company_name}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="portal-field-label">Portal status</dt>
                  <dd className="portal-detail-value">
                    <ContactPortalStatusBadge status={contact.portal_status} />
                  </dd>
                </div>
                <div>
                  <dt className="portal-field-label">Email</dt>
                  <dd className="portal-detail-value">{contact.email || "—"}</dd>
                </div>
                <div>
                  <dt className="portal-field-label">Phone</dt>
                  <dd className="portal-detail-value">{contact.phone || "—"}</dd>
                </div>
                <div>
                  <dt className="portal-field-label">Primary contact</dt>
                  <dd className="portal-detail-value">
                    {contact.is_primary ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="portal-field-label">Active</dt>
                  <dd className="portal-detail-value">
                    {contact.is_active ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="portal-field-label">Created</dt>
                  <dd className="portal-detail-value">
                    {formatCrmDateTime(contact.created_at)}
                  </dd>
                </div>
                <div>
                  <dt className="portal-field-label">Updated</dt>
                  <dd className="portal-detail-value">
                    {formatCrmDateTime(contact.updated_at)}
                  </dd>
                </div>
                {contact.invited_at ? (
                  <div>
                    <dt className="portal-field-label">Last invited</dt>
                    <dd className="portal-detail-value">
                      {formatCrmDateTime(contact.invited_at)}
                    </dd>
                  </div>
                ) : null}
                {contact.notes ? (
                  <div className="sm:col-span-2">
                    <dt className="portal-field-label">Notes</dt>
                    <dd className="portal-detail-value whitespace-pre-wrap">
                      {contact.notes}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {contact.profile_id ? (
            <Card id="portal-user" className="portal-surface overflow-hidden">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-lg font-semibold">
                  Portal user
                </CardTitle>
                <CardDescription>
                  Linked profile for portal access.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <dl className="grid gap-5 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="portal-field-label">Profile ID</dt>
                    <dd className="portal-detail-value font-mono text-xs">
                      {contact.profile_id}
                    </dd>
                  </div>
                  <div>
                    <dt className="portal-field-label">Account status</dt>
                    <dd className="portal-detail-value">
                      {contact.profile_account_status || "—"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {notesAndActivity ? (
            <>
              <Card className="portal-surface overflow-hidden">
                <CardHeader className="border-b border-border">
                  <CardTitle className="text-lg font-semibold">
                    CRM notes
                  </CardTitle>
                  <CardDescription>
                    Internal staff notes for this contact.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <NoteComposer
                    context={{
                      companyId: contact.company_id,
                      contactId: contact.id,
                    }}
                  />
                  <NotesList notes={notesAndActivity[0]} />
                </CardContent>
              </Card>

              <ActivityTimeline
                items={notesAndActivity[1].items}
                title="Contact activity"
                description="Activity linked to this contact and related records."
              />
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
