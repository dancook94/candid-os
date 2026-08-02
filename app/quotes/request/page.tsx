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
import { createClient } from "@/lib/supabase/server";
import { loadAppSettings } from "@/lib/app-settings-server";

export default async function QuoteRequestPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, appSettingsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, company_id, account_status")
      .eq("id", user.id)
      .single(),
    loadAppSettings(supabase),
  ]);

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  const canSubmit =
    profile?.account_status === "approved" && Boolean(profile.company_id);

  return (
    <AppShell userRole="customer" userName={fullName} companyName={companyName}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Request a quote"
          description="Submit your project details and delivery requirements."
        />

        {canSubmit ? (
          <QuoteRequestForm
            companyId={profile.company_id}
            requestedBy={user.id}
            defaultDeadlineStatus={
              appSettingsResult.settings.default_deadline_status
            }
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
