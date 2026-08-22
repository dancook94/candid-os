"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type ResendAccountReadyButtonProps = {
  profileId: string;
};

export function ResendAccountReadyButton({
  profileId,
}: ResendAccountReadyButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleResend() {
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/admin/customers/${profileId}/resend-account-ready`,
        { method: "POST" }
      );
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        notification?: {
          ok?: boolean;
          skippedReason?: string | null;
          failureReason?: string | null;
          adminMessage?: string | null;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to resend account-ready email.");
      }

      if (payload.notification?.ok === false) {
        const message =
          payload.notification.adminMessage ??
          payload.notification.failureReason ??
          payload.notification.skippedReason ??
          "Notification delivery failed.";
        setError(`Email not sent: ${message}`);
      } else {
        setMessage("Account-ready email sent. Check Admin → Notifications for delivery details.");
      }

      router.refresh();
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Unable to resend account-ready email."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleResend()}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Sending..." : "Resend account-ready email"}
      </Button>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
