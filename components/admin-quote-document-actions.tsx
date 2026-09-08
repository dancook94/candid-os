"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { QuoteDownloadPdfButton } from "@/components/customer-quote-download-pdf-button";
import { TestCommunicationHint } from "@/components/communication-mode-banner";
import { Button } from "@/components/ui/button";
import { isTestCommunicationModePublic } from "@/lib/communications/config";
import { isAdminQuotePdfDownloadable } from "@/lib/customer-quote-request";

type AdminQuoteDocumentActionsProps = {
  quoteId: string;
  versionId: string;
  versionNumber: number;
  versionStatus: string;
  currentVersionNumber: number;
  quoteStatus: string;
};

type ResendQuoteApiResponse = {
  ok?: boolean;
  quoteSent?: boolean;
  resent?: boolean;
  emailSent?: boolean;
  emailError?: string | null;
  communicationMode?: string;
  email?: {
    notificationId?: string | null;
    redirected?: boolean;
  };
  error?: string;
};

export function AdminQuoteDocumentActions({
  quoteId,
  versionId,
  versionNumber,
  versionStatus,
  currentVersionNumber,
  quoteStatus,
}: AdminQuoteDocumentActionsProps) {
  const router = useRouter();
  const [isResending, setIsResending] = useState(false);
  const [isRetryingEmail, setIsRetryingEmail] = useState(false);
  const [success, setSuccess] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [failedNotificationId, setFailedNotificationId] = useState<string | null>(
    null
  );

  const canDownloadPdf = isAdminQuotePdfDownloadable(versionStatus);
  const canResendQuote =
    quoteStatus !== "draft" &&
    versionStatus === "sent" &&
    versionNumber === currentVersionNumber;

  async function handleResendQuote() {
    if (isResending) {
      return;
    }

    setError("");
    setSuccess("");
    setWarning("");
    setFailedNotificationId(null);
    setIsResending(true);

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, resend: true }),
      });

      const payload = (await response.json()) as ResendQuoteApiResponse;

      if (!response.ok || !payload.ok || !payload.resent) {
        setError(payload.error ?? payload.emailError ?? "Unable to resend quote.");
        return;
      }

      if (payload.emailSent) {
        let message = "Quote resent successfully.";

        if (
          payload.communicationMode === "test" &&
          payload.email?.redirected
        ) {
          message +=
            " Test mode redirected the customer email to the configured test recipient.";
        }

        setSuccess(message);
      } else {
        setWarning(
          payload.emailError ??
            "Quote remains sent, but the email could not be delivered."
        );
        setFailedNotificationId(payload.email?.notificationId ?? null);
      }

      router.refresh();
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Unable to resend quote."
      );
    } finally {
      setIsResending(false);
    }
  }

  async function handleRetryQuoteEmail() {
    if (!failedNotificationId || isRetryingEmail) {
      return;
    }

    setIsRetryingEmail(true);

    try {
      const response = await fetch(
        `/api/admin/notifications/${failedNotificationId}/retry`,
        { method: "POST" }
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        status?: string;
      };

      if (!response.ok || !payload.ok || payload.status !== "sent") {
        setWarning(
          payload.error ??
            "Quote remains sent, but the email could not be delivered."
        );
        return;
      }

      setWarning("");
      setSuccess("Quote email sent successfully.");
      setFailedNotificationId(null);
    } catch (retryError) {
      setWarning(
        retryError instanceof Error
          ? retryError.message
          : "Quote remains sent, but the email could not be delivered."
      );
    } finally {
      setIsRetryingEmail(false);
    }
  }

  if (!canDownloadPdf && !canResendQuote) {
    return null;
  }

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-neutral-950">Quote documents</h2>
          <p className="text-sm text-neutral-500">
            Download the branded quote PDF or resend the current sent version to the
            customer.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canResendQuote && (
            <Button
              type="button"
              variant="outline"
              disabled={isResending || isRetryingEmail}
              onClick={handleResendQuote}
            >
              {isResending
                ? "Resending..."
                : isTestCommunicationModePublic()
                  ? "Resend quote (Test)"
                  : "Resend quote"}
            </Button>
          )}
          {canDownloadPdf && (
            <QuoteDownloadPdfButton
              quoteId={quoteId}
              downloadPath={`/api/admin/quotes/${quoteId}/pdf?version=${versionNumber}`}
            />
          )}
        </div>
      </div>

      {canResendQuote && <TestCommunicationHint />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {warning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">{warning}</p>
          {failedNotificationId && (
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRetryingEmail || isResending}
                onClick={handleRetryQuoteEmail}
              >
                {isRetryingEmail ? "Retrying email..." : "Retry email"}
              </Button>
            </div>
          )}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      )}
    </div>
  );
}
