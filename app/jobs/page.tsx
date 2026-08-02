import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CustomerJobsList } from "@/components/customer-jobs-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { loadCustomerJobs } from "@/lib/customer-jobs";
import {
  buildCustomerAppShellProps,
  requireCustomerPortalUser,
} from "@/lib/customer-shell-props";
import { createClient } from "@/lib/supabase/server";

export default async function CustomerJobsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await requireCustomerPortalUser(supabase, user, redirect);
  const shellProps = await buildCustomerAppShellProps(supabase, user, profile);

  const canLoadCompanyJobs =
    profile.account_status === "approved" && Boolean(profile.company_id);

  const { jobs, jobsDataAvailable } = canLoadCompanyJobs
    ? await loadCustomerJobs(supabase, profile.company_id!)
    : { jobs: [], jobsDataAvailable: false };

  const emptyActions = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Link href="/quotes">
        <Button variant="outline">View quotes</Button>
      </Link>
      <Link href="/quotes/request">
        <Button>Request a quote</Button>
      </Link>
    </div>
  );

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Jobs"
          description="Track active and completed work for your company."
        />

        {jobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="Accepted work will appear here once it has been converted into production."
            action={emptyActions}
          />
        ) : (
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <CustomerJobsList jobs={jobs} />
            </CardContent>
          </Card>
        )}

        {process.env.NODE_ENV === "development" && !jobsDataAvailable ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Production jobs schema is not deployed yet. This page will list
            company jobs once a customer-safe jobs table and quote-to-job
            workflow exist.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
