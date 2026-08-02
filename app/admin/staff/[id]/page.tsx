import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EditStaffForm } from "@/components/edit-staff-form";
import { PageHeader } from "@/components/page-header";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isCandidAdminRole,
  isStaffRole,
  isSuperAdminRole,
  resolveAdminAccessDeniedPath,
} from "@/lib/staff-roles";

export const dynamic = "force-dynamic";

type AdminStaffDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminStaffDetailPage({
  params,
}: AdminStaffDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(`/admin/staff/${id}`));
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

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch {
    notFound();
  }

  const { data: staffProfile, error: staffProfileError } = await adminClient
    .from("profiles")
    .select("id, full_name, user_role, account_status")
    .eq("id", id)
    .maybeSingle();

  if (staffProfileError || !staffProfile || !isStaffRole(staffProfile.user_role)) {
    notFound();
  }

  if (
    isSuperAdminRole(staffProfile.user_role) &&
    staffProfile.id !== user.id
  ) {
    redirect("/admin/staff");
  }

  const { data: authData, error: authError } =
    await adminClient.auth.admin.getUserById(staffProfile.id);

  if (authError) {
    notFound();
  }

  return (
    <AppShell
      userRole="admin"
      showStaffNav
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Administration"
          title={staffProfile.full_name || "Staff member"}
          description="Edit staff profile, role and account access."
        />

        <EditStaffForm
          staffId={staffProfile.id}
          fullName={staffProfile.full_name ?? ""}
          email={authData.user.email ?? null}
          role={staffProfile.user_role}
          accountStatus={staffProfile.account_status}
        />
      </div>
    </AppShell>
  );
}
