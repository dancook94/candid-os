import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const plannedSections = [
  {
    title: "Company details",
    description: "Business name, contact details and branding defaults.",
  },
  {
    title: "Quote numbering",
    description: "Prefix, sequence and formatting for issued quotes.",
  },
  {
    title: "Payment terms",
    description: "Default payment terms applied to new quotes and companies.",
  },
  {
    title: "Integrations",
    description: "Connect accounting, email and other external services.",
  },
];

export default async function AdminSettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.user_role !== "admin" ||
    profile.account_status !== "approved"
  ) {
    redirect("/dashboard");
  }

  return (
    <AppShell
      userRole="admin"
      userName={profile.full_name || "Candid administrator"}
      companyName="Candid Creative"
    >
      <div className="mx-auto max-w-4xl">
        <PageHeader
          eyebrow="Administration"
          title="Settings"
          description="Configure Candid OS defaults and integrations."
        />

        <div className="space-y-4">
          {plannedSections.map((section) => (
            <Card
              key={section.title}
              className="rounded-2xl border-neutral-200 shadow-sm ring-0"
            >
              <CardHeader className="border-b border-neutral-200">
                <CardTitle className="text-lg font-semibold text-neutral-950">
                  {section.title}
                </CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>

              <CardContent className="pt-6">
                <p className="text-sm text-neutral-500">Coming soon.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
