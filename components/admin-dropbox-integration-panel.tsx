"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { clearDropboxPendingSetup } from "@/lib/dropbox/clear-pending-setup";
import { maskDropboxRefreshToken, type DropboxPendingOAuthResult } from "@/lib/dropbox/oauth";

type AdminDropboxIntegrationPanelProps = {
  canManage: boolean;
  connection: DropboxConnectionStatus;
  pendingSetup: DropboxPendingOAuthResult | null;
  initialError: string | null;
  initialSetupPending: boolean;
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
}: AdminDropboxIntegrationPanelProps) {
  const router = useRouter();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isClearingSetup, setIsClearingSetup] = useState(false);
  const [clearSetupError, setClearSetupError] = useState<string | null>(null);

  async function copyToClipboard(value: string, field: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 2000);
  }

  async function handleClearPendingSetup() {
    setClearSetupError(null);
    setIsClearingSetup(true);

    try {
      const result = await clearDropboxPendingSetup();

      if (!result.ok) {
        setClearSetupError(result.error ?? "Unable to clear setup token.");
        setIsClearingSetup(false);
        return;
      }

      setIsClearingSetup(false);
      router.refresh();
    } catch {
      setClearSetupError("Unable to clear setup token.");
      setIsClearingSetup(false);
    }
  }

  return (
    <div className="space-y-6">
      {initialError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{initialError}</p>
        </div>
      ) : null}

      {pendingSetup ? (
        <Card className="portal-surface overflow-hidden border-emerald-200">
          <CardHeader className="border-b border-emerald-200 bg-emerald-50">
            <CardTitle className="text-lg font-semibold text-emerald-950">
              Dropbox connected successfully
            </CardTitle>
            <CardDescription className="text-emerald-900">
              Copy the refresh token below into your server environment, then restart
              the app. This token is shown once for security and is never included in
              the URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Connected account</p>
              <p className="mt-2 text-sm text-foreground">
                {pendingSetup.accountName}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingSetup.accountEmail}
              </p>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Refresh token</p>
              <p className="mt-2 break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
                {maskDropboxRefreshToken(pendingSetup.refreshToken)}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
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
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isClearingSetup}
                    onClick={() => void handleClearPendingSetup()}
                  >
                    {isClearingSetup ? "Clearing..." : "Clear setup token"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">Add to .env.local</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-muted px-3 py-3 font-mono text-xs text-foreground">
{`DROPBOX_REFRESH_TOKEN=<copied token>
DROPBOX_ROOT_FOLDER=${pendingSetup.rootFolder}`}
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
                Restart the app after updating the environment. Once{" "}
                <span className="font-mono">DROPBOX_REFRESH_TOKEN</span> is configured,
                this page will show Connected and hide this setup panel.
              </p>
            </div>

            {clearSetupError ? (
              <p className="text-sm text-red-600">{clearSetupError}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : initialSetupPending ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            Dropbox authorization completed, but the one-time setup token is no longer
            available. Connect Dropbox again to generate a fresh refresh token.
          </p>
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
          {pendingSetup ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-950">
                Complete the one-time setup above to copy{" "}
                <span className="font-mono">DROPBOX_REFRESH_TOKEN</span> into your
                environment.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {connection.envVars.map((item) => {
              const pendingRefreshToken =
                item.name === "DROPBOX_REFRESH_TOKEN" && pendingSetup;

              return (
                <div key={item.name} className="rounded-xl border border-border p-4">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <div className="mt-2">
                    <ConfigStatus
                      configured={item.configured}
                      label={
                        pendingRefreshToken
                          ? "Pending setup"
                          : undefined
                      }
                    />
                  </div>
                </div>
              );
            })}
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
    </div>
  );
}
