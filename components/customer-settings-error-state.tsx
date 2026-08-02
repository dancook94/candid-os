"use client";

import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CustomerSettingsErrorStateProps = {
  message?: string;
  developmentMessage?: string | null;
};

export function CustomerSettingsErrorState({
  message = "Settings could not be loaded.",
  developmentMessage = null,
}: CustomerSettingsErrorStateProps) {
  const router = useRouter();
  const showDevelopmentMessage =
    process.env.NODE_ENV === "development" && developmentMessage;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your profile, company details, and portal preferences."
      />

      <Card className="portal-surface">
        <CardHeader>
          <CardTitle>{message}</CardTitle>
          <CardDescription>
            We could not load your settings right now. Your account data has not
            been changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showDevelopmentMessage ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {developmentMessage}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => router.refresh()}>
              Retry
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/dashboard")}>
              Return to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
