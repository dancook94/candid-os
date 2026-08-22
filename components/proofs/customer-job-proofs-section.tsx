"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  PROOF_CONFIRMATION_TEXT,
  PROOF_STATUS_LABELS,
} from "@/lib/proofs/constants";
import { manifestItemsForProofDisplay } from "@/lib/proofs/gates";
import {
  mapCustomerProofStatusToBadge,
  type CustomerProofState,
} from "@/lib/proofs/customer-state";
import type { JobProofView } from "@/lib/proofs/types";
import { getCustomerProofFile } from "@/lib/proofs/proof-files";
import { getCurrentProofRecord } from "@/lib/proofs/versioning";

type CustomerJobProofsSectionProps = {
  jobId: string;
  proofRequired: boolean;
  proofState: CustomerProofState;
  proofs: JobProofView[];
  schemaMissing?: boolean;
};

function mapProofStatusToBadge(status: string) {
  switch (status) {
    case "approved":
      return "approved" as const;
    case "sent":
    case "viewed":
      return "sent" as const;
    case "changes_requested":
      return "pending" as const;
    case "superseded":
      return "draft" as const;
    default:
      return "pending" as const;
  }
}

export function CustomerJobProofsSection({
  jobId,
  proofRequired,
  proofState,
  proofs,
  schemaMissing,
}: CustomerJobProofsSectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [pendingProofId, setPendingProofId] = useState<string | null>(null);
  const [changeComment, setChangeComment] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<Record<string, boolean>>({});

  const latestActionable = proofs.find((proof) =>
    ["sent", "viewed"].includes(proof.status)
  );
  const currentProof = getCurrentProofRecord(proofs);

  async function markViewed(proofId: string) {
    await fetch(`/api/customer/jobs/${jobId}/proofs/${proofId}/download`, {
      method: "POST",
    });
  }

  async function approveProof(proofId: string) {
    setError(null);
    setPendingProofId(proofId);

    const response = await fetch(`/api/customer/jobs/${jobId}/proofs/${proofId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationAccepted: Boolean(confirmation[proofId]) }),
    });

    const payload = (await response.json()) as { error?: string };
    setPendingProofId(null);

    if (!response.ok) {
      setError(payload.error ?? "Unable to approve proof.");
      return;
    }

    window.location.reload();
  }

  async function requestChanges(proofId: string) {
    setError(null);
    setPendingProofId(proofId);

    const response = await fetch(`/api/customer/jobs/${jobId}/proofs/${proofId}/changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: changeComment[proofId] ?? "" }),
    });

    const payload = (await response.json()) as { error?: string };
    setPendingProofId(null);

    if (!response.ok) {
      setError(payload.error ?? "Unable to request changes.");
      return;
    }

    window.location.reload();
  }

  if (schemaMissing) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Proofs</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <StatusBadge
            status={mapCustomerProofStatusToBadge(proofState.status)}
            label={proofState.label}
          />
          {currentProof ? (
            <p className="text-sm text-muted-foreground">
              Current proof: Version {currentProof.version_number}
            </p>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {proofs.map((proof) => {
        const items = manifestItemsForProofDisplay(proof.manifestItems);
        const canAction = latestActionable?.id === proof.id;
        const isReadOnly =
          proof.status === "superseded" ||
          (["changes_requested", "approved"].includes(proof.status) && !canAction);

        return (
          <div
            key={proof.id}
            id={`proof-${proof.id}`}
            className={`rounded-lg border p-4 space-y-3 ${
              proof.status === "superseded" ? "opacity-70 bg-muted/20" : "border-border"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {proof.title} · Proof v{proof.version_number}
                </p>
                {proof.sent_at ? (
                  <p className="text-xs text-muted-foreground">
                    Sent {new Date(proof.sent_at).toLocaleString("en-GB")}
                  </p>
                ) : null}
              </div>
              <StatusBadge
                status={mapProofStatusToBadge(proof.status)}
                label={PROOF_STATUS_LABELS[proof.status]}
              />
            </div>

            {proof.customer_message ? (
              <p className="text-sm">{proof.customer_message}</p>
            ) : null}

            {items.length ? (
              <div className="text-sm">
                <p className="font-medium">Related items</p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {items.map((item, index) => (
                    <li key={`${proof.id}-${index}`}>{item.summary}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {getCustomerProofFile(proof.files) ? (
              <p className="text-sm text-muted-foreground">
                Proof file: {getCustomerProofFile(proof.files)?.file_name}
              </p>
            ) : null}

            {proof.status === "changes_requested" && proof.changes_requested_comment ? (
              <p className="text-sm text-amber-900">
                Your comments: {proof.changes_requested_comment}
              </p>
            ) : null}

            {proof.approved_at ? (
              <p className="text-sm font-medium text-emerald-700">
                Approved on {new Date(proof.approved_at).toLocaleDateString("en-GB")}
              </p>
            ) : null}

            {getCustomerProofFile(proof.files) ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await markViewed(proof.id);
                    window.open(
                      `/api/customer/jobs/${jobId}/proofs/${proof.id}/download`,
                      "_blank"
                    );
                  }}
                >
                  Download proof
                </Button>
              </div>
            ) : null}

            {canAction ? (
              <div className="space-y-3 border-t border-border pt-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(confirmation[proof.id])}
                    onChange={(event) =>
                      setConfirmation((current) => ({
                        ...current,
                        [proof.id]: event.target.checked,
                      }))
                    }
                  />
                  <span>{PROOF_CONFIRMATION_TEXT}</span>
                </label>

                <Button
                  type="button"
                  disabled={pendingProofId === proof.id || !confirmation[proof.id]}
                  onClick={() => approveProof(proof.id)}
                >
                  Approve proof
                </Button>

                <div className="space-y-2">
                  <Label htmlFor={`changes-${proof.id}`}>Request changes</Label>
                  <Textarea
                    id={`changes-${proof.id}`}
                    value={changeComment[proof.id] ?? ""}
                    onChange={(event) =>
                      setChangeComment((current) => ({
                        ...current,
                        [proof.id]: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Describe the changes you need…"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pendingProofId === proof.id || !(changeComment[proof.id] ?? "").trim()}
                    onClick={() => requestChanges(proof.id)}
                  >
                    Request changes
                  </Button>
                </div>
              </div>
            ) : null}

            {isReadOnly ? (
              <p className="text-xs text-muted-foreground">
                Version {proof.version_number} — {PROOF_STATUS_LABELS[proof.status]} (read only)
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
