"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  formatLostReasonForStorage,
  getLostReasonOptions,
  type LostReasonOption,
} from "@/lib/crm/lost-reasons";

type LostReasonDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (lostReason: string) => void;
};

export function LostReasonDialog({
  open,
  onCancel,
  onConfirm,
}: LostReasonDialogProps) {
  const [selected, setSelected] = useState<LostReasonOption>("Price");
  const [otherText, setOtherText] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return null;
  }

  function handleConfirm() {
    const formatted = formatLostReasonForStorage(selected, otherText);

    if (!formatted) {
      setError("Please provide a lost reason.");
      return;
    }

    onConfirm(formatted);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Mark as lost</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Select a reason before moving this opportunity to Lost.
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lostReasonSelect">Reason</Label>
            <Select
              id="lostReasonSelect"
              value={selected}
              onChange={(event) =>
                setSelected(event.target.value as LostReasonOption)
              }
            >
              {getLostReasonOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {selected === "Other" ? (
            <div className="space-y-2">
              <Label htmlFor="lostReasonOther">Additional details</Label>
              <Textarea
                id="lostReasonOther"
                value={otherText}
                onChange={(event) => setOtherText(event.target.value)}
                rows={3}
              />
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            Confirm lost
          </Button>
        </div>
      </div>
    </div>
  );
}
