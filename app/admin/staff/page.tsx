import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { InviteStaffDialog } from "@/components/invite-staff-dialog";
import { PageHeader } from "@/components/page-header";
import { StaffManagementTable } from "@/components/staff-management-table";
import { Card, CardContent } from "@/components/ui/card";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { loadStaffMembersWithAuth, type StaffMemberRecord } from "@/lib/staff-members";
import { isCandidAdminRole, isSuperAdminRole, resolveAdminAccessDeniedPath } from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/admin/staff"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.account_status !== "approved" ||
    !isSuperAdminRole(profile.user_role)
  ) {
    if (profile && isCandidAdminRole(profile.user_role)) {
      redirect("/admin");
    }

    redirect(resolveAdminAccessDeniedPath(profile?.user_role));
  }

  let staffMembers: StaffMemberRecord[] = [];
  let loadError: string | null = null;

  try {
    staffMembers = await loadStaffMembersWithAuth();
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load staff members.";
  }

  const isDevelopment = process.env.NODE_ENV === "development";

  return (
    <AppShell
      userRole="admin"
      showStaffNav
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Staff"
          description="Manage Candid OS team access, roles and account status."
          actions={<InviteStaffDialog />}
        />

        {isDevelopment && loadError ? (
          <Card className="mb-6 rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-red-800">
                Staff query error
              </p>
              <p className="mt-2 text-sm text-red-700">{loadError}</p>
            </CardContent>
          </Card>
        ) : null}

        {!loadError && staffMembers.length === 0 ? (
          <EmptyState
            title="No staff members yet"
            description="Invite your first team member to get started."
          />
        ) : !loadError ? (
          <StaffManagementTable staffMembers={staffMembers} />
        ) : null}
      </div>
    </AppShell>
  );
}
