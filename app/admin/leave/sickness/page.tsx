import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { SicknessRecordPanel } from "@/components/staff-leave/sickness-record-panel";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import {
  ADMIN_LEAVE_PATH,
  ADMIN_LEAVE_SICKNESS_PATH,
  requireAdminLeavePageAccess,
} from "@/lib/staff-leave/page-access";
import { fetchStaffMembersForLeaveAdmin } from "@/lib/staff-leave/queries";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLeaveSicknessPage() {
  const supabase = await createClient();
  await requireAdminLeavePageAccess(supabase, ADMIN_LEAVE_SICKNESS_PATH);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: shellProfile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status, avatar_storage_path")
    .eq("id", user!.id)
    .single();

  const { members } = await fetchStaffMembersForLeaveAdmin(supabase);
  const shellProps = await buildAdminAppShellProps(supabase, shellProfile!);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <PageHeader
            eyebrow="Holiday & absence"
            title="Sickness recording"
            description="Management-only. Staff never see sickness reasons, notes, or private notes on the holiday calendar."
          />
          <Link href={ADMIN_LEAVE_PATH} className={buttonVariants({ variant: "outline" })}>
            Holiday management
          </Link>
        </div>

        <Card className="portal-surface rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>Record absence</CardTitle>
            <CardDescription>
              Half-day sickness uses the same AM/PM portions as annual leave requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <SicknessRecordPanel
              members={members}
              holidayYear={STAFF_LEAVE_FIRST_POLICY_YEAR}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
