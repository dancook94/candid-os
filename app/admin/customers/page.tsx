import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { ContactsTable } from "@/components/crm/contacts-table";
import { NewContactButton } from "@/components/crm/contact-form-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { fetchContactsList } from "@/lib/crm/contacts";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/customers");

  const [{ contacts, queryError }, { data: companies }] = await Promise.all([
    fetchContactsList(supabase, { search }),
    supabase
      .from("companies")
      .select("id, company_name")
      .order("company_name"),
  ]);

  const isDevelopment = process.env.NODE_ENV === "development";
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const companyOptions = companies ?? [];

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="CRM"
          title="Contacts"
          description="Manage customer contacts and optional portal access."
          actions={
            <NewContactButton
              companies={companyOptions}
              label="New contact"
            />
          }
        />

        {queryError ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">
                Contacts query error
              </p>
              <p className="mt-2 text-sm text-red-700">{queryError}</p>
              {!isDevelopment ? (
                <p className="mt-2 text-sm text-red-700">
                  Contact list could not be loaded. Details are shown above when
                  available.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {!queryError && contacts.length === 0 ? (
          <EmptyState
            title="No contacts yet"
            description="Add a contact to start building CRM records before inviting anyone to the portal."
            action={
              <NewContactButton companies={companyOptions} label="New contact" />
            }
          />
        ) : null}

        {!queryError && contacts.length > 0 ? (
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <ContactsTable contacts={contacts} companies={companyOptions} />
            </CardContent>
          </Card>
        ) : null}

        <p className="mt-6 text-sm text-muted-foreground">
          Portal invitations are sent from individual contacts.{" "}
          <Link href="/admin/companies" className="text-foreground hover:underline">
            Manage companies
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
