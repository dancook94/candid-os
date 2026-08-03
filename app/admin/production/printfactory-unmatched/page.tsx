import Link from "next/link";
import { Link2Off } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PrintfactoryUnmatchedPage() {
  const supabase = await createClient();
  const profile = await requireCrmPageAccess(
    supabase,
    "/admin/production/printfactory-unmatched"
  );
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Production"
          title="PrintFactory unmatched"
          description="Review PrintFactory jobs that could not be automatically matched to Candid production items."
          actions={
            <Link href="/admin/production">
              <Button variant="outline">Back to board</Button>
            </Link>
          }
        />

        <Card className="portal-surface">
          <CardContent className="py-12">
            <EmptyState
              icon={<Link2Off className="h-5 w-5" aria-hidden />}
              title="PrintFactory sync is not enabled yet"
              description="When PrintFactory integration is connected, unmatched jobs will appear here with source paths, suggested Candid job matches, and actions to match or ignore. Matching will use Synology source paths containing the Candid job reference — not customer name or project title alone."
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
