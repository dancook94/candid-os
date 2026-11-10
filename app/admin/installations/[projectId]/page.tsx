import Link from "next/link";
import { notFound } from "next/navigation";

import { InstallationProjectPanel } from "@/components/installations/installation-project-panel";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import { canManageInstallations, canOperateInstallations } from "@/lib/installations/permissions";
import { requireInstallationReader } from "@/lib/installations/page-access";
import { loadInstallationProject, loadInstallerOptions } from "@/lib/installations/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InstallationProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const profile = await requireInstallationReader(supabase, `/admin/installations/${projectId}`);
  const shell = await buildPortalAppShellProps(supabase, profile);
  const admin = createAdminClient();
  const [project, installers] = await Promise.all([
    loadInstallationProject(admin, supabase, projectId),
    loadInstallerOptions(admin),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <AppShell {...shell}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Installation"
          title={project.jobName || project.title}
          description={`${project.jobReference || "No job number"} · ${project.companyName}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/installations">
                <Button variant="outline">Board</Button>
              </Link>
              {project.jobId ? (
                <Link href={`/admin/jobs/${project.jobId}`}>
                  <Button variant="outline">Job</Button>
                </Link>
              ) : null}
              {project.quoteId ? (
                <Link href={`/admin/quotes/${project.quoteId}`}>
                  <Button variant="outline">Quote{project.quoteNumber ? ` Q-${project.quoteNumber}` : ""}</Button>
                </Link>
              ) : null}
            </div>
          }
        />

        <InstallationProjectPanel
          project={project}
          installers={installers}
          canManage={canManageInstallations(profile)}
          canOperate={canOperateInstallations(profile)}
        />
      </div>
    </AppShell>
  );
}
