import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CreateCompanyDialog } from "@/components/create-company-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function CompaniesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.user_role !== "admin" ||
    profile.account_status !== "approved"
  ) {
    redirect("/dashboard");
  }

  const { data: companies } = await supabase
    .from("companies")
    .select("*")
    .order("company_name");

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Companies"
          description="Manage customer companies."
          actions={<CreateCompanyDialog />}
        />

        {!companies || companies.length === 0 ? (
          <EmptyState
            title="No companies yet"
            description="Create a company to assign customers during approval."
          />
        ) : (
          <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-sm ring-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50/50">
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Company
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Trading Name
                      </th>
                      <th className="p-4 text-left font-medium text-neutral-500">
                        Payment Terms
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {companies.map((company) => (
                      <tr
                        key={company.id}
                        className="border-b border-neutral-200 last:border-0 hover:bg-neutral-50"
                      >
                        <td className="p-4 font-medium text-neutral-950">
                          {company.company_name}
                        </td>

                        <td className="p-4 text-neutral-600">
                          {company.trading_name}
                        </td>

                        <td className="p-4 text-neutral-600">
                          {company.payment_terms_days} days
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
