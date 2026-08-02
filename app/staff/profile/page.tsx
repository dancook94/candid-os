import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StaffAvatarForm } from "@/components/staff-avatar-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";
import { isStaffRole } from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/staff/profile"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, user_role, account_status, avatar_storage_path, avatar_file_name, avatar_file_type, avatar_file_size"
    )
    .eq("id", user.id)
    .single();

  if (!profile || profile.account_status !== "approved" || !isStaffRole(profile.user_role)) {
    redirect("/login");
  }

  const avatarPreviewUrl = await loadStaffAvatarSignedUrl(supabase, profile);
  const userRole = profile.user_role === "admin" || profile.user_role === "super_admin"
    ? "admin"
    : "staff";

  return (
    <AppShell
      userRole={userRole}
      showStaffNav={profile.user_role === "super_admin"}
      userName={profile.full_name || "Candid team member"}
      companyName="Candid Creative"
      userAvatarUrl={avatarPreviewUrl}
    >
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Account"
          title="Profile"
          description="Manage your Candid OS profile photo."
        />

        <Card className="portal-surface overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Profile photo</CardTitle>
            <CardDescription>
              Your photo appears in the portal sidebar and staff views.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <StaffAvatarForm
              fullName={profile.full_name || "Candid team member"}
              initialAvatar={{
                avatar_storage_path: profile.avatar_storage_path,
                avatar_file_name: profile.avatar_file_name,
                avatar_file_type: profile.avatar_file_type,
                avatar_file_size: profile.avatar_file_size,
              }}
              initialPreviewUrl={avatarPreviewUrl}
              uploadUrl="/api/staff/avatar"
              removeUrl="/api/staff/avatar"
            />
          </CardContent>
        </Card>

        <p className="mt-4 text-sm text-muted-foreground">
          <Link href={userRole === "admin" ? "/admin" : "/staff"} className="underline-offset-4 hover:underline">
            Back to workspace
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
