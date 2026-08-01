import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CreateCompanyDialog } from "@/components/create-company-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatPaymentTermsLabel } from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/server";
import { buildLoginUrl } from "@/lib/auth-redirect";

export default async function CompaniesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/admin/companies"));
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
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Trading Name</th>
                      <th>Payment Terms</th>
                    </tr>
                  </thead>

                  <tbody>
                    {companies.map((company) => (
                      <tr key={company.id} className="cursor-pointer hover:bg-muted/35">
                        <td className="p-0">
                          <Link
                            href={`/admin/companies/${company.id}`}
                            className="block px-4 py-3.5 font-medium text-foreground"
                          >
                            {company.company_name}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/companies/${company.id}`}
                            className="block px-4 py-3.5 text-muted-foreground"
                          >
                            {company.trading_name || "—"}
                          </Link>
                        </td>

                        <td className="p-0">
                          <Link
                            href={`/admin/companies/${company.id}`}
                            className="block px-4 py-3.5 text-muted-foreground"
                          >
                            {formatPaymentTermsLabel(company.payment_terms_days)}
                          </Link>
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
