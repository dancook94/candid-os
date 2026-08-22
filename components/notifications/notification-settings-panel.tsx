"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmailConfigStatus } from "@/lib/app-settings";
import type { ResendConfigStatus } from "@/lib/notifications/config";
import {
  CUSTOMER_NOTIFICATION_TYPES,
  formatNotificationTypeLabel,
  INTERNAL_NOTIFICATION_TYPES,
  INTERNAL_RECIPIENT_GROUPS,
  TESTABLE_NOTIFICATION_TYPES,
  type InternalRecipientGroup,
} from "@/lib/notifications/notification-types";
import type { NotificationSettingsPayload } from "@/lib/notifications/settings";

type NotificationSettingsPanelProps = {
  initialSettings: NotificationSettingsPayload;
  canEdit: boolean;
  resendConfig: ResendConfigStatus;
  emailConfig: EmailConfigStatus;
};

function groupLabel(group: InternalRecipientGroup) {
  return group.charAt(0).toUpperCase() + group.slice(1);
}

export function NotificationSettingsPanel({
  initialSettings,
  canEdit,
  resendConfig,
  emailConfig,
}: NotificationSettingsPanelProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [saveState, setSaveState] = useState({ loading: false, error: "", success: "" });
  const [testState, setTestState] = useState({
    loading: false,
    error: "",
    success: "",
    recipientEmail: "",
    notificationType: TESTABLE_NOTIFICATION_TYPES[0],
  });

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSaveState({ loading: true, error: "", success: "" });

    try {
      const response = await fetch("/api/admin/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = (await response.json()) as {
        error?: string;
        settings?: NotificationSettingsPayload;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save notification settings.");
      }

      if (payload.settings) {
        setSettings(payload.settings);
      }

      setSaveState({
        loading: false,
        error: "",
        success: "Notification settings saved.",
      });
    } catch (error) {
      setSaveState({
        loading: false,
        error: error instanceof Error ? error.message : "Unable to save settings.",
        success: "",
      });
    }
  }

  async function sendTestEmail(event: FormEvent) {
    event.preventDefault();
    setTestState((current) => ({ ...current, loading: true, error: "", success: "" }));

    try {
      const response = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: testState.recipientEmail,
          notificationType: testState.notificationType,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          results?: Array<{ providerMessageId?: string | null; status?: string }>;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Test email failed.");
      }

      const providerMessageId =
        payload.result?.results?.[0]?.providerMessageId ?? null;
      const status = payload.result?.results?.[0]?.status ?? "unknown";

      setTestState((current) => ({
        ...current,
        loading: false,
        success: `Test email ${status}.${providerMessageId ? ` Resend ID: ${providerMessageId}` : ""}`,
        error: "",
      }));
    } catch (error) {
      setTestState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Test email failed.",
        success: "",
      }));
    }
  }

  function toggleCustomer(type: (typeof CUSTOMER_NOTIFICATION_TYPES)[number]) {
    setSettings((current) => ({
      ...current,
      customer: {
        ...current.customer,
        [type]: !current.customer[type],
      },
    }));
  }

  function toggleInternal(type: (typeof INTERNAL_NOTIFICATION_TYPES)[number]) {
    setSettings((current) => ({
      ...current,
      internal: {
        ...current.internal,
        [type]: !current.internal[type],
      },
    }));
  }

  function updateGroupEmails(group: InternalRecipientGroup, value: string) {
    const emails = value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    setSettings((current) => ({
      ...current,
      recipientGroups: {
        ...current.recipientGroups,
        [group]: emails,
      },
    }));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email delivery status</CardTitle>
          <CardDescription>
            Resend and development safety settings for Candid OS notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>Resend API</span>
            <ConfigStatus configured={resendConfig.configured} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span>App URL</span>
            <ConfigStatus configured={emailConfig.appUrlConfigured} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span>Email mode</span>
            <StatusBadge status="sent" label={resendConfig.emailMode} />
          </div>
          <p className="text-muted-foreground">
            Sender: {resendConfig.fromName} &lt;{resendConfig.fromEmail}&gt;
          </p>
          {resendConfig.developmentSafetyActive ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              Development safety is active. Non-live modes create notification records and redirect or suppress outbound email.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <form onSubmit={saveSettings} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Customer notifications</CardTitle>
            <CardDescription>
              Toggle customer-facing transactional emails sent through the central notification service.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {CUSTOMER_NOTIFICATION_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.customer[type]}
                  disabled={!canEdit}
                  onChange={() => toggleCustomer(type)}
                />
                <span>{formatNotificationTypeLabel(type)}</span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Internal Candid notifications</CardTitle>
            <CardDescription>
              Toggle staff/internal alerts and configure recipient groups.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2">
              {INTERNAL_NOTIFICATION_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.internal[type]}
                    disabled={!canEdit}
                    onChange={() => toggleInternal(type)}
                  />
                  <span>{formatNotificationTypeLabel(type)}</span>
                </label>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {INTERNAL_RECIPIENT_GROUPS.map((group) => (
                <div key={group} className="space-y-2">
                  <Label htmlFor={`group-${group}`}>{groupLabel(group)} recipients</Label>
                  <textarea
                    id={`group-${group}`}
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={!canEdit}
                    value={settings.recipientGroups[group].join("\n")}
                    onChange={(event) => updateGroupEmails(group, event.target.value)}
                    placeholder="one@example.com"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saveState.loading}>
              {saveState.loading ? "Saving…" : "Save notification settings"}
            </Button>
            {saveState.error ? (
              <p className="text-sm text-destructive">{saveState.error}</p>
            ) : null}
            {saveState.success ? (
              <p className="text-sm text-emerald-700">{saveState.success}</p>
            ) : null}
          </div>
        ) : null}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Send test email</CardTitle>
          <CardDescription>
            Preview a notification template. Test mode redirects to EMAIL_TEST_RECIPIENT when configured.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendTestEmail} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="test-recipient">Recipient</Label>
              <Input
                id="test-recipient"
                type="email"
                value={testState.recipientEmail}
                onChange={(event) =>
                  setTestState((current) => ({
                    ...current,
                    recipientEmail: event.target.value,
                  }))
                }
                placeholder="you@example.com"
                disabled={!canEdit || testState.loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="test-type">Template / event</Label>
              <select
                id="test-type"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={testState.notificationType}
                disabled={!canEdit || testState.loading}
                onChange={(event) =>
                  setTestState((current) => ({
                    ...current,
                    notificationType: event.target.value as typeof current.notificationType,
                  }))
                }
              >
                {TESTABLE_NOTIFICATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {formatNotificationTypeLabel(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <Button type="submit" disabled={!canEdit || testState.loading}>
                {testState.loading ? "Sending…" : "Send test email"}
              </Button>
              {testState.error ? (
                <p className="text-sm text-destructive">{testState.error}</p>
              ) : null}
              {testState.success ? (
                <p className="text-sm text-emerald-700">{testState.success}</p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        View delivery history in{" "}
        <Link href="/admin/notifications" className="underline">
          Notifications
        </Link>
        .
      </p>
    </div>
  );
}

function ConfigStatus({ configured }: { configured: boolean }) {
  return (
    <StatusBadge
      status={configured ? "approved" : "pending"}
      label={configured ? "Configured" : "Not configured"}
    />
  );
}
