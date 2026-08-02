"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DropboxConnectionStatus } from "@/lib/dropbox/connection-status";
import type { DropboxPendingOAuthResult } from "@/lib/dropbox/oauth";

type AdminDropboxIntegrationPanelProps = {
  canManage: boolean;
  connection: DropboxConnectionStatus;
  pendingSetup: DropboxPendingOAuthResult | null;
  initialError: string | null;
  initialSetupPending: boolean;
  appUrl: string;
};

function ConfigStatus({
  configured,
  label,
}: {
  configured: boolean;
  label?: string;
}) {
  return (
    <StatusBadge
      status={configured ? "approved" : "pending"}
      label={label ?? (configured ? "Configured" : "Not configured")}
    />
  );
}

export function AdminDropboxIntegrationPanel({
  canManage,
  connection,
  pendingSetup,
  initialError,
  initialSetupPending,
  appUrl,
}: AdminDropboxIntegrationPanelProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function copyToClipboard(value: string, field: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 2000);
  }

  return (
    <div className="space-y-6">
      {initialError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{initialError}</p>
        </div>
      ) : null}

      <Card className="portal-surface overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">Connection status</CardTitle>
          <CardDescription>
            Candid OS uses offline Dropbox access so artwork uploads can refresh tokens
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              status={connection.connected ? "approved" : "pending"}
              label={connection.connected ? "Connected" : "Not connected"}
            />
            {connection.connected && connection.accountEmail ? (
              <p className="text-sm text-muted-foreground">
                Signed in as{" "}
                <span className="font-medium text-foreground">
                  {connection.accountEmail}
                </span>
              </p>
            ) : null}
          </div>

          {connection.connected ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-foreground">Dropbox account</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {connection.accountEmail ?? "—"}
                </p>
                {connection.accountName ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connection.accountName}
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-foreground">Jobs root folder</p>
                <p className="mt-2 font-mono text-sm text-muted-foreground">
                  {connection.rootFolder}
                </p>
              </div>
            </div>
          ) : connection.error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-950">{connection.error}</p>
            </div>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap gap-3">
              <a href="/api/admin/integrations/dropbox/connect">
                <Button type="button">
                  {connection.connected ? "Reconnect Dropbox" : "Connect Dropbox"}
                </Button>
              </a>
              <Link href="/admin/settings">
                <Button type="button" variant="outline">
                  Back to settings
                </Button>
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only super admins can connect Dropbox for Candid OS.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="portal-surface overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">Environment configuration</CardTitle>
          <CardDescription>
            Secret values stay on the server. After connecting Dropbox, add the refresh
            token to your deployment environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            {connection.envVars.map((item) => (
              <div key={item.name} className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-foreground">{item.name}</p>
                <div className="mt-2">
                  <ConfigStatus configured={item.configured} />
                </div>
              </div>
            ))}
          </div>

          {connection.redirectUri ? (
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Dropbox redirect URI</p>
              <p className="mt-2 break-all font-mono text-sm text-muted-foreground">
                {connection.redirectUri}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Add this exact URI to your Dropbox app settings.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {pendingSetup ? (
        <Card className="portal-surface overflow-hidden border-emerald-200">
          <CardHeader className="border-b border-emerald-200 bg-emerald-50">
            <CardTitle className="text-lg font-semibold text-emerald-950">
              Dropbox authorized successfully
            </CardTitle>
            <CardDescription className="text-emerald-900">
              Add the refresh token below to your server environment to finish setup.
              This token is shown once for security.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Authorized account</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {pendingSetup.accountEmail}
              </p>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Refresh token</p>
              <p className="mt-2 break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
                {pendingSetup.refreshToken}
              </p>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void copyToClipboard(pendingSetup.refreshToken, "refresh-token")
                  }
                >
                  {copiedField === "refresh-token" ? "Copied" : "Copy refresh token"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Add to .env.local</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-muted px-3 py-3 font-mono text-xs text-foreground">
{`DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=${pendingSetup.refreshToken}
DROPBOX_ROOT_FOLDER=${pendingSetup.rootFolder}
NEXT_PUBLIC_APP_URL=${appUrl}`}
              </pre>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void copyToClipboard(
                      `DROPBOX_REFRESH_TOKEN=${pendingSetup.refreshToken}\nDROPBOX_ROOT_FOLDER=${pendingSetup.rootFolder}`,
                      "env-snippet"
                    )
                  }
                >
                  {copiedField === "env-snippet" ? "Copied" : "Copy env snippet"}
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Restart the app after updating the environment. Future job artwork uploads
                will use <span className="font-mono">{pendingSetup.rootFolder}</span> as
                the Dropbox root folder.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : initialSetupPending ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            Dropbox authorization completed, but the one-time setup token has expired.
            Connect Dropbox again to generate a fresh refresh token.
          </p>
        </div>
      ) : null}
    </div>
  );
}
