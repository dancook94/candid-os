import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ApproveCustomer } from "@/components/approve-customer";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, account_status, user_role")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.account_status !== "approved" ||
    profile.user_role !== "admin"
  ) {
    redirect("/dashboard");
  }

  const { data: pendingUsers } = await supabase
    .from("profiles")
    .select(
      "id, full_name, requested_company_name, account_status, created_at"
    )
    .eq("account_status", "pending")
    .order("created_at", { ascending: true });

  const { data: companies } = await supabase
    .from("companies")
    .select("id, company_name")
    .eq("is_active", true)
    .order("company_name");

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="text-sm font-medium text-neutral-500">
            Administration
          </p>

          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">
            Admin dashboard
          </h1>

          <p className="mt-2 text-neutral-600">
            Manage customer registrations and portal access.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-neutral-950">
              Pending customer approvals
            </h2>
          </div>

          {!pendingUsers || pendingUsers.length === 0 ? (
            <div className="px-6 py-10 text-sm text-neutral-500">
              There are no customers awaiting approval.
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {pendingUsers.map((pendingUser) => (
                <div
                  key={pendingUser.id}
                  className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div>
                    <p className="font-medium text-neutral-950">
                      {pendingUser.full_name || "Unnamed customer"}
                    </p>

                    <p className="mt-1 text-sm text-neutral-500">
                      {pendingUser.requested_company_name ||
                        "No company supplied"}
                    </p>
                  </div>

                  <ApproveCustomer
                    profileId={pendingUser.id}
                    companies={companies ?? []}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}