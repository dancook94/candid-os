import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

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
      <div className="max-w-7xl">

        <div className="flex items-center justify-between mb-8">

          <div>
            <h1 className="text-3xl font-bold">
              Companies
            </h1>

            <p className="text-neutral-500 mt-2">
              Manage customer companies.
            </p>

          </div>

          <button className="rounded-lg bg-black px-5 py-3 text-white">
            + New Company
          </button>

        </div>

        <div className="rounded-xl border bg-white">

          <table className="w-full">

            <thead>

              <tr className="border-b">

                <th className="p-4 text-left">Company</th>
                <th className="p-4 text-left">Trading Name</th>
                <th className="p-4 text-left">Payment Terms</th>

              </tr>

            </thead>

            <tbody>

              {companies?.map((company) => (

                <tr
                  key={company.id}
                  className="border-b hover:bg-neutral-50"
                >

                  <td className="p-4">
                    {company.company_name}
                  </td>

                  <td className="p-4">
                    {company.trading_name}
                  </td>

                  <td className="p-4">
                    {company.payment_terms_days} days
                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </div>

    </AppShell>
  );
}