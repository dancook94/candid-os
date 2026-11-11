"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { InstallationReportVersion } from "@/lib/installations/queries";
import { formatLondonWhen } from "@/lib/installations/labels";

type DeliveryRow = {
  id: string;
  recipientEmail: string;
  sentAt: string;
  attachPdf: boolean;
  providerStatus: string | null;
  errorMessage: string | null;
  sentByName: string | null;
};

type RecipientOption = {
  contactId: string;
  fullName: string;
  email: string;
  hasPortalAccess: boolean;
  isJobContact: boolean;
};

export function InstallationReportCustomerActions({
  report,
  visitPublishedReportId,
}: {
  report: InstallationReportVersion;
  visitPublishedReportId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [confirmResend, setConfirmResend] = useState(false);
  const [acknowledgeNoPortalAccess, setAcknowledgeNoPortalAccess] = useState(false);
  const [recipientHasPortalAccess, setRecipientHasPortalAccess] = useState<boolean | null>(null);
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);

  const isPublished = report.isPublished;

  async function loadDeliveries() {
    const response = await fetch(`/api/admin/installations/reports/${report.id}/send`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { deliveries?: DeliveryRow[] };
    setDeliveries(payload.deliveries ?? []);
  }

  async function publish(action: "publish" | "unpublish") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/installations/reports/${report.id}/${action === "publish" ? "publish" : "unpublish"}`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage(payload?.error ?? "The publication status could not be updated.");
        return;
      }
      setMessage(
        action === "publish"
          ? `${report.reportReference} published to the customer portal.`
          : "Customer portal access removed."
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function previewEmail(nextRecipientEmail = recipientEmail) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/installations/reports/${report.id}/send/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: customerMessage, recipientEmail: nextRecipientEmail }),
      });
      const payload = (await response.json()) as {
        error?: string;
        html?: string;
        subject?: string;
        defaultRecipientEmail?: string | null;
        recipients?: RecipientOption[];
        recipientPortalAccess?: { hasPortalAccess: boolean } | null;
      };
      if (!response.ok) {
        setMessage(payload.error ?? "The email could not be previewed.");
        return;
      }
      setPreviewHtml(payload.html ?? null);
      setPreviewSubject(payload.subject ?? null);
      setRecipients(payload.recipients ?? []);
      if (!nextRecipientEmail && payload.defaultRecipientEmail) {
        setRecipientEmail(payload.defaultRecipientEmail);
        setRecipientHasPortalAccess(
          payload.recipients?.find((row) => row.email === payload.defaultRecipientEmail)?.hasPortalAccess ??
            payload.recipientPortalAccess?.hasPortalAccess ??
            null
        );
      } else {
        setRecipientHasPortalAccess(payload.recipientPortalAccess?.hasPortalAccess ?? null);
      }
      setShowSend(true);
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/installations/reports/${report.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail,
          message: customerMessage,
          attachPdf,
          confirmResend,
          acknowledgeNoPortalAccess,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        duplicate?: boolean;
        requiresPortalAcknowledgement?: boolean;
      };
      if (response.status === 409 && payload.duplicate) {
        setConfirmResend(true);
        setMessage(payload.error ?? "This report was already sent to that address.");
        return;
      }
      if (response.status === 409 && payload.requiresPortalAcknowledgement) {
        setAcknowledgeNoPortalAccess(false);
        setMessage(payload.error ?? "Confirm sending to a recipient without portal access.");
        return;
      }
      if (!response.ok) {
        setMessage(payload.error ?? "The email could not be sent.");
        return;
      }
      setMessage("Installation report email sent.");
      setConfirmResend(false);
      setAcknowledgeNoPortalAccess(false);
      await loadDeliveries();
    } finally {
      setBusy(false);
    }
  }

  const publicationLabel = useMemo(() => {
    if (!isPublished) {
      if (visitPublishedReportId && visitPublishedReportId !== report.id) {
        return "Another version is published for this visit.";
      }
      return "Not published to the customer portal.";
    }
    return report.publishedAt
      ? `Published ${formatLondonWhen(report.publishedAt)}${report.publishedByName ? ` by ${report.publishedByName}` : ""}.`
      : "Published to the customer portal.";
  }, [isPublished, report, visitPublishedReportId]);

  return (
    <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
      <p className="text-xs text-neutral-600">{publicationLabel}</p>
      <div className="flex flex-wrap gap-2">
        {isPublished ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void publish("unpublish")}>
            Unpublish
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void publish("publish")}>
            Publish to customer portal
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !isPublished}
          onClick={() => {
            setShowSend((current) => !current);
            if (!deliveries) {
              void loadDeliveries();
            }
            if (!showSend) {
              void previewEmail();
            }
          }}
        >
          Send to customer
        </Button>
      </div>
      {showSend ? (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          {recipients.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor={`report-recipient-${report.id}`}>Company contact</Label>
              <select
                id={`report-recipient-${report.id}`}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                value={recipients.find((row) => row.email === recipientEmail)?.contactId ?? ""}
                onChange={(event) => {
                  const match = recipients.find((row) => row.contactId === event.target.value);
                  if (!match) {
                    return;
                  }
                  setRecipientEmail(match.email);
                  setRecipientHasPortalAccess(match.hasPortalAccess);
                  setAcknowledgeNoPortalAccess(false);
                  void previewEmail(match.email);
                }}
              >
                <option value="">Choose a contact</option>
                {recipients.map((row) => (
                  <option key={row.contactId} value={row.contactId}>
                    {row.fullName} ({row.email}){row.isJobContact ? " · job contact" : ""}
                    {row.hasPortalAccess ? "" : " · no portal"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`report-email-${report.id}`}>Customer email</Label>
            <input
              id={`report-email-${report.id}`}
              type="email"
              value={recipientEmail}
              onChange={(event) => {
                setRecipientEmail(event.target.value);
                setAcknowledgeNoPortalAccess(false);
              }}
              onBlur={() => void previewEmail(recipientEmail)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              placeholder="customer@example.com"
            />
          </div>
          {recipientHasPortalAccess === false ? (
            <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <p>This recipient does not have Candid OS portal access. The secure report link will not work for them until they are invited.</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={acknowledgeNoPortalAccess}
                  onChange={(event) => setAcknowledgeNoPortalAccess(event.target.checked)}
                />
                Send anyway
              </label>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`report-message-${report.id}`}>Message</Label>
            <textarea
              id={`report-message-${report.id}`}
              value={customerMessage}
              onChange={(event) => setCustomerMessage(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Optional note to include in the customer email."
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={attachPdf} onChange={(event) => setAttachPdf(event.target.checked)} />
            Attach the PDF
          </label>
          {confirmResend ? (
            <p className="text-xs text-amber-800">
              This address already received this report. Send again only if you mean to resend it.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void previewEmail()}>
              Refresh preview
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || (recipientHasPortalAccess === false && !acknowledgeNoPortalAccess)}
              onClick={() => void sendEmail()}
            >
              {confirmResend ? "Resend email" : "Send email"}
            </Button>
          </div>
          {previewSubject ? <p className="text-xs text-neutral-500">Subject: {previewSubject}</p> : null}
          {previewHtml ? (
            <iframe title="Email preview" srcDoc={previewHtml} className="h-64 w-full rounded border border-neutral-200 bg-white" />
          ) : null}
        </div>
      ) : null}
      {deliveries && deliveries.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Delivery history</p>
          <ul className="space-y-1 text-xs text-neutral-600">
            {deliveries.map((delivery) => (
              <li key={delivery.id}>
                {delivery.recipientEmail} · {formatLondonWhen(delivery.sentAt)}
                {delivery.attachPdf ? " · PDF attached" : ""}
                {delivery.providerStatus && delivery.providerStatus !== "sent"
                  ? ` · ${delivery.providerStatus}`
                  : ""}
                {delivery.errorMessage ? ` · Error: ${delivery.errorMessage}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? <p className="text-xs text-neutral-700">{message}</p> : null}
    </div>
  );
}
