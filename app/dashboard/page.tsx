import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fullName =
    user.user_metadata?.full_name || user.email || "Customer";

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  return (
    <AppShell userRole="customer" userName={fullName} companyName={companyName}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Candid OS"
          title={`Welcome, ${fullName}`}
          description={companyName}
        />

        <div className="grid gap-5 md:grid-cols-3">
          <StatCard
            label="Quotes"
            value="0"
            description="Current and historic quotes"
          />

          <StatCard
            label="Quote requests"
            value="0"
            description="Requests awaiting review"
          />

          <StatCard
            label="Account status"
            value={<StatusBadge status="pending" />}
            description="Candid will confirm your company access."
          />
        </div>

        <Card className="mt-8 rounded-2xl border-neutral-200 shadow-sm ring-0">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">
              Request a quote
            </CardTitle>

            <CardDescription>
              Quote requests and mandatory delivery details will be added next.
            </CardDescription>
          </CardHeader>

          <CardContent />
        </Card>
      </div>
    </AppShell>
  );
}
