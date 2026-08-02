import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { EditStaffForm } from "@/components/edit-staff-form";
import { PageHeader } from "@/components/page-header";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { StaffAvatarForm } from "@/components/staff-avatar-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { resolveAdminAccessDeniedPath } from "@/lib/portal-access";
import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isAdminRole,
  isStaffRole,
  isSuperAdminRole,
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
    .select("full_name, user_role, account_status, avatar_storage_path")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.account_status !== "approved" ||
    !isSuperAdminRole(profile.user_role)
  ) {
    if (profile && isAdminRole(profile.user_role)) {
      redirect("/admin");
    }

    redirect(resolveAdminAccessDeniedPath(profile));
  }

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch {
    notFound();
  }

  const { data: staffProfile, error: staffProfileError } = await adminClient
    .from("profiles")
    .select(
      "id, full_name, user_role, account_status, avatar_storage_path, avatar_file_name, avatar_file_type, avatar_file_size"
    )
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

  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const staffAvatarPreviewUrl = await loadStaffAvatarSignedUrl(
    adminClient,
    staffProfile
  );

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            eyebrow="Administration"
            title={staffProfile.full_name || "Staff member"}
            description="Edit staff profile, role and account access."
          />

          <StaffAvatarDisplay
            fullName={staffProfile.full_name || "Staff member"}
            avatarUrl={staffAvatarPreviewUrl}
            size="lg"
          />
        </div>

        <Card className="portal-surface mb-6 overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Profile photo</CardTitle>
            <CardDescription>
              Manage this team member&apos;s portal avatar.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <StaffAvatarForm
              fullName={staffProfile.full_name || "Staff member"}
              initialAvatar={{
                avatar_storage_path: staffProfile.avatar_storage_path,
                avatar_file_name: staffProfile.avatar_file_name,
                avatar_file_type: staffProfile.avatar_file_type,
                avatar_file_size: staffProfile.avatar_file_size,
              }}
              initialPreviewUrl={staffAvatarPreviewUrl}
              uploadUrl={`/api/admin/staff/${staffProfile.id}/avatar`}
              removeUrl={`/api/admin/staff/${staffProfile.id}/avatar`}
            />
          </CardContent>
        </Card>

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
