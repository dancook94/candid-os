"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  isPermanentDeleteConfirmationValid,
  PERMANENT_DELETE_CONFIRMATION_LABEL,
  PERMANENT_DELETE_CONFIRMATION_PLACEHOLDER,
} from "@/lib/permanent-delete-confirmation";

type ConfirmTextMatchDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmationValue: string;
  onConfirmationChange: (value: string) => void;
  confirmLabel: string;
  confirmingLabel?: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
};

export function ConfirmTextMatchDialog({
  open,
  title,
  description,
  confirmationValue,
  onConfirmationChange,
  confirmLabel,
  confirmingLabel = "Processing...",
  isSubmitting,
  onCancel,
  onConfirm,
  destructive = false,
}: ConfirmTextMatchDialogProps) {
  if (!open) {
    return null;
  }

  const matches = isPermanentDeleteConfirmationValid(confirmationValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-neutral-950/40"
        onClick={() => {
          if (!isSubmitting) {
            onCancel();
          }
        }}
      />

      <Card
        className={`relative z-10 w-full max-w-md rounded-2xl shadow-lg ring-0 ${
          destructive ? "border-red-200" : "border-neutral-200"
        }`}
      >
        <CardHeader className={`border-b ${destructive ? "border-red-200" : "border-neutral-200"}`}>
          <CardTitle
            className={`text-lg font-semibold ${
              destructive ? "text-red-900" : "text-neutral-950"
            }`}
          >
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <label
              htmlFor="confirm-text-match-input"
              className="text-sm font-medium text-foreground"
            >
              {PERMANENT_DELETE_CONFIRMATION_LABEL}
            </label>
            <Input
              id="confirm-text-match-input"
              value={confirmationValue}
              disabled={isSubmitting}
              onChange={(event) => onConfirmationChange(event.target.value)}
              placeholder={PERMANENT_DELETE_CONFIRMATION_PLACEHOLDER}
              autoComplete="off"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              disabled={isSubmitting || !matches}
              onClick={onConfirm}
            >
              {isSubmitting ? confirmingLabel : confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
