import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ApproveCustomer } from "@/components/approve-customer";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
        <PageHeader
          eyebrow="Administration"
          title="Admin dashboard"
          description="Manage customer registrations and portal access."
        />

        <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
          <CardHeader className="border-b border-neutral-200">
            <CardTitle className="text-lg font-semibold text-neutral-950">
              Pending customer approvals
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            {!pendingUsers || pendingUsers.length === 0 ? (
              <EmptyState
                className="border-0 shadow-none"
                title="No pending approvals"
                description="There are no customers awaiting approval."
              />
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
