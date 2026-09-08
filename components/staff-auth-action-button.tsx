"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { StaffAuthActionType } from "@/lib/staff-auth-actions";

type StaffAuthActionButtonProps = {
  staffId: string;
  email: string | null;
  actionType: StaffAuthActionType;
  compact?: boolean;
};

const ACTION_CONFIG: Record<
  StaffAuthActionType,
  {
    label: string;
    sendingLabel: string;
    confirmMessage: (email: string) => string;
    endpoint: (staffId: string) => string;
  }
> = {
  resend_invite: {
    label: "Resend invite",
    sendingLabel: "Sending...",
    confirmMessage: (email) =>
      `Send a new invitation email to ${email}?`,
    endpoint: (staffId) => `/api/admin/staff/${staffId}/resend-invite`,
  },
  send_password_setup: {
    label: "Send password setup link",
    sendingLabel: "Sending...",
    confirmMessage: (email) =>
      `Send a new password setup link to ${email}?`,
    endpoint: (staffId) => `/api/admin/staff/${staffId}/send-password-setup`,
  },
};

export function StaffAuthActionButton({
  staffId,
  email,
  actionType,
  compact = false,
}: StaffAuthActionButtonProps) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const config = ACTION_CONFIG[actionType];

  if (!email) {
    return null;
  }

  async function handleClick() {
    if (isSending) {
      return;
    }

    setError("");
    setSuccess("");

    const confirmed = window.confirm(config.confirmMessage(email!));

    if (!confirmed) {
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch(config.endpoint(staffId), {
        method: "POST",
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to complete this action.");
        return;
      }

      setSuccess(payload.message ?? "Request completed successfully.");
    } catch {
      setError("Unable to complete this action.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className={compact ? "inline-flex flex-col gap-1" : "space-y-2"}>
      <Button
        type="button"
        variant="outline"
        size={compact ? "sm" : "default"}
        disabled={isSending}
        onClick={handleClick}
        className={
          compact
            ? "h-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]"
            : undefined
        }
      >
        {isSending ? config.sendingLabel : config.label}
      </Button>

      {error ? (
        <p
          className={
            compact
              ? "max-w-48 text-xs text-red-700"
              : "text-sm text-red-700"
          }
        >
          {error}
        </p>
      ) : null}

      {success ? (
        <p
          className={
            compact
              ? "max-w-48 text-xs text-emerald-700"
              : "text-sm text-emerald-700"
          }
        >
          {success}
        </p>
      ) : null}
    </div>
  );
}
