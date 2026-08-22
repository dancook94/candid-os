"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import type { PreflightCheck, PreflightResult } from "@/lib/proof-generator/types";
import { PROOF_ATTACHABLE_STATUSES } from "@/lib/proofs/constants";
import { getFileExtension } from "@/lib/proofs/file-validation";
import type { JobProofView } from "@/lib/proofs/types";

type ProofBrandedPdfPanelProps = {
  jobId: string;
  proof: JobProofView;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string | null) => void;
  onRefresh: () => Promise<void>;
  onRequestAttach: () => void;
};

type PanelStep = "idle" | "review";

function mapCheckStatusToBadge(status: PreflightCheck["status"]) {
  switch (status) {
    case "pass":
      return "approved" as const;
    case "warning":
      return "pending" as const;
    case "manual_review":
      return "declined" as const;
    default:
      return "draft" as const;
  }
}

function mapOverallStatusToBadge(status: PreflightResult["overallStatus"]) {
  switch (status) {
    case "pass":
      return "approved" as const;
    case "warning":
      return "pending" as const;
    default:
      return "declined" as const;
  }
}

function hasGeneratorEligibleAttachment(proof: JobProofView) {
  const proofFile = proof.files[0];
  if (!proofFile?.dropbox_path) {
    return false;
  }

  const extension = getFileExtension(proofFile.file_name);
  return ["pdf", "jpg", "jpeg", "png"].includes(extension);
}

export function ProofBrandedPdfPanel({
  jobId,
  proof,
  pending,
  onPendingChange,
  onError,
  onRefresh,
  onRequestAttach,
}: ProofBrandedPdfPanelProps) {
  const [step, setStep] = useState<PanelStep>("idle");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [warningsReviewed, setWarningsReviewed] = useState<Record<string, boolean>>({});

  const canGenerate = PROOF_ATTACHABLE_STATUSES.includes(
    proof.status as (typeof PROOF_ATTACHABLE_STATUSES)[number]
  );
  const hasAttachment = hasGeneratorEligibleAttachment(proof);

  const warningChecks = useMemo(
    () =>
      (preflight?.checks ?? []).filter(
        (check) => check.status === "warning" || check.status === "manual_review"
      ),
    [preflight]
  );

  if (!canGenerate) {
    return null;
  }

  async function analyseArtwork() {
    onError(null);
    onPendingChange(true);

    const response = await fetch(
      `/api/admin/jobs/${jobId}/proofs/${proof.id}/branded-pdf/analyse`,
      { method: "POST" }
    );

    const payload = (await response.json()) as {
      preflight?: PreflightResult;
      error?: string;
    };

    onPendingChange(false);

    if (!response.ok) {
      onError(payload.error ?? "Unable to analyse proof artwork.");
      return;
    }

    setPreflight(payload.preflight ?? null);
    setWarningsReviewed({});
    setStep("review");
  }

  async function generateBrandedPdf() {
    onError(null);

    if (!preflight) {
      onError("Run artwork analysis before generating the branded PDF.");
      return;
    }

    const unreviewedWarnings = warningChecks.filter(
      (check) => !warningsReviewed[check.key]
    );

    if (unreviewedWarnings.length > 0) {
      onError("Confirm each warning or manual review item before generating.");
      return;
    }

    onPendingChange(true);

    const response = await fetch(
      `/api/admin/jobs/${jobId}/proofs/${proof.id}/branded-pdf/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preflight }),
      }
    );

    const payload = (await response.json()) as { error?: string };

    onPendingChange(false);

    if (!response.ok) {
      onError(payload.error ?? "Unable to generate branded proof PDF.");
      return;
    }

    setStep("idle");
    setPreflight(null);
    setWarningsReviewed({});
    await onRefresh();
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <p className="text-sm font-medium">Branded customer proof PDF</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Analyse the attached artwork, review preflight checks, then generate the
          Candid Creative branded PDF into the job&apos;s 03 Proofs folder. Source
          artwork is retained in Dropbox.
        </p>
      </div>

      {step === "idle" ? (
        <div className="flex flex-wrap gap-2">
          {!hasAttachment ? (
            <Button type="button" variant="outline" size="sm" onClick={onRequestAttach}>
              Attach proof artwork
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void analyseArtwork()}
            >
              Generate branded proof PDF
            </Button>
          )}
        </div>
      ) : null}

      {step === "review" && preflight ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Preflight analysis</span>
            <StatusBadge
              status={mapOverallStatusToBadge(preflight.overallStatus)}
              label={
                preflight.overallStatus === "pass"
                  ? "Pass"
                  : preflight.overallStatus === "warning"
                    ? "Warnings"
                    : "Manual review required"
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Quoted specification</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {preflight.quotedItems.map((item) => (
                  <li key={item.id}>
                    {item.itemReference ?? "Item"} · {item.itemName}
                    {item.quotedWidthMm != null && item.quotedHeightMm != null
                      ? ` · ${item.quotedWidthMm} × ${item.quotedHeightMm} mm`
                      : ""}
                    {item.quantity != null ? ` · Qty ${item.quantity}` : ""}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Artwork specification</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                <li>File: {preflight.metadata.fileName}</li>
                <li>
                  Detected size:{" "}
                  {preflight.metadata.pageSize.value
                    ? `${preflight.metadata.pageSize.value.widthMm} × ${preflight.metadata.pageSize.value.heightMm} mm`
                    : "—"}
                </li>
                <li>Pages: {preflight.metadata.pageCount ?? "—"}</li>
                <li>Colour mode: {preflight.metadata.colourMode.value ?? "Unknown"}</li>
                {preflight.sizeComparison?.matchedScaleLabel ? (
                  <li>Scale: {preflight.sizeComparison.matchedScaleLabel}</li>
                ) : null}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Automated checks</p>
            <div className="space-y-2">
              {preflight.checks.map((check) => (
                <div
                  key={check.key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3 text-sm"
                >
                  <div>
                    <StatusBadge
                      status={mapCheckStatusToBadge(check.status)}
                      label={check.label}
                    />
                    <p className="mt-2 text-muted-foreground">{check.message}</p>
                  </div>
                  {check.status === "warning" || check.status === "manual_review" ? (
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(warningsReviewed[check.key])}
                        onChange={(event) =>
                          setWarningsReviewed((current) => ({
                            ...current,
                            [check.key]: event.target.checked,
                          }))
                        }
                      />
                      Reviewed
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setStep("idle");
                setPreflight(null);
                setWarningsReviewed({});
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void analyseArtwork()}
            >
              Re-analyse
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => void generateBrandedPdf()}
            >
              Generate branded proof PDF
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
