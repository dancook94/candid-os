import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { QuoteRequestForm } from "@/components/quote-request-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadQuoteRequestSavedAddresses } from "@/lib/quote-request/submit-customer-quote-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  buildCustomerAppShellProps,
  loadCustomerPortalProfile,
} from "@/lib/customer-shell-props";
import { loadAppSettings } from "@/lib/app-settings-server";

export default async function QuoteRequestPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [profile, appSettingsResult] = await Promise.all([
    loadCustomerPortalProfile(supabase, user.id),
    loadAppSettings(supabase),
  ]);

  const shellProps = await buildCustomerAppShellProps(supabase, user, profile);

  const canSubmit =
    profile?.account_status === "approved" && Boolean(profile.company_id);

  const savedAddresses = canSubmit
    ? await loadQuoteRequestSavedAddresses(
        createAdminClient(),
        profile!.company_id!
      )
    : { available: false, addresses: [] };

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Request a quote"
          description="Submit your project details and delivery requirements."
        />

        {canSubmit ? (
          <QuoteRequestForm
            companyId={profile!.company_id!}
            requestedBy={user.id}
            companyName={shellProps.companyName}
            defaultDeadlineStatus={
              appSettingsResult.settings.default_deadline_status
            }
            savedAddresses={savedAddresses.addresses}
            savedAddressesAvailable={savedAddresses.available}
          />
        ) : (
          <Card className="portal-surface">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">
                Quote requests unavailable
              </CardTitle>
              <CardDescription>
                Your account must be approved and linked to a company before
                you can submit quote requests.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <Link href="/quotes">
                <Button variant="outline">Back to quotes</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
