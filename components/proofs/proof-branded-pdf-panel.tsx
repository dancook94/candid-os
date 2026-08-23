"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { validateOperatorConfirmation } from "@/lib/proof-generator/operator-confirmation";
import type { PreflightResult, PreflightOperatorConfirmation } from "@/lib/proof-generator/types";
import type { JobProofView } from "@/lib/proofs/types";
import { canGenerateBrandedPdf, requiresGeneratedCustomerProof } from "@/lib/proofs/workflow-policy";
import {
  getCustomerProofFile,
  getSourceArtworkFile,
  hasGeneratedCustomerProof,
} from "@/lib/proofs/proof-files";
import { ProofPreflightReview } from "@/components/proofs/proof-preflight-review";

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

function formatTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString("en-GB");
}

function mapGenerationErrorMessage(payload: { error?: string }, response: Response) {
  if (payload.error?.trim()) {
    return payload.error;
  }

  if (response.status === 404) {
    return "Source artwork could not be found in Dropbox. Please attach the current artwork again.";
  }

  if (response.status === 409) {
    return "This proof version cannot be updated. Create a revised proof if you need a new version.";
  }

  if (response.status >= 500) {
    return "Failed to generate branded proof PDF. Check server logs for details.";
  }

  return "Unable to generate branded proof PDF.";
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
  const [panelError, setPanelError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const canGenerate = canGenerateBrandedPdf(proof);
  const sourceArtwork = getSourceArtworkFile(proof.files ?? []);
  const customerProof = getCustomerProofFile(proof.files ?? []);
  const hasAttachment = requiresGeneratedCustomerProof(proof);
  const hasCustomerProof = hasGeneratedCustomerProof(proof.files ?? []);

  const warningChecks = useMemo(
    () =>
      (preflight?.checks ?? []).filter(
        (check) =>
          check.status === "warning" ||
          check.status === "manual_review" ||
          check.status === "fail"
      ),
    [preflight]
  );

  if (!canGenerate) {
    return null;
  }

  async function analyseArtwork() {
    setPanelError(null);
    setSuccessMessage(null);
    onError(null);
    onPendingChange(true);

    try {
      const response = await fetch(
        `/api/admin/jobs/${jobId}/proofs/${proof.id}/branded-pdf/analyse`,
        { method: "POST" }
      );

      let payload: { preflight?: PreflightResult; error?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const message = payload.error ?? "Unable to analyse proof artwork.";
        setPanelError(message);
        onError(message);
        return;
      }

      setPreflight(payload.preflight ?? null);
      setWarningsReviewed({});
      setStep("review");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to analyse proof artwork.";
      setPanelError(message);
      onError(message);
    } finally {
      onPendingChange(false);
    }
  }

  async function generateBrandedPdf(operatorConfirmation: PreflightOperatorConfirmation) {
    setPanelError(null);
    setSuccessMessage(null);
    onError(null);

    if (!preflight) {
      const message = "Run artwork analysis before generating the branded PDF.";
      setPanelError(message);
      onError(message);
      return;
    }

    const confirmationErrors = validateOperatorConfirmation(preflight, operatorConfirmation);
    if (confirmationErrors.length > 0) {
      const message = confirmationErrors.join(" ");
      setPanelError(message);
      onError(message);
      return;
    }

    const unreviewedWarnings = warningChecks.filter(
      (check) => !warningsReviewed[check.key]
    );

    if (unreviewedWarnings.length > 0) {
      const message = "Confirm each warning, review, or fail item before generating.";
      setPanelError(message);
      onError(message);
      return;
    }

    onPendingChange(true);
    setGenerating(true);

    try {
      const response = await fetch(
        `/api/admin/jobs/${jobId}/proofs/${proof.id}/branded-pdf/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatorConfirmation }),
        }
      );

      let payload: { error?: string; generatedFileName?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const message = mapGenerationErrorMessage(payload, response);
        setPanelError(message);
        onError(message);
        return;
      }

      const message = payload.generatedFileName
        ? `Proof PDF generated successfully: ${payload.generatedFileName}`
        : "Proof PDF generated successfully.";
      setSuccessMessage(message);
      setStep("idle");
      setPreflight(null);
      setWarningsReviewed({});
      onError(null);
      await onRefresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate branded proof PDF.";
      setPanelError(message);
      onError(message);
    } finally {
      setGenerating(false);
      onPendingChange(false);
    }
  }

  function downloadCustomerProof() {
    window.open(`/api/admin/jobs/${jobId}/proofs/${proof.id}/download`, "_blank");
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <p className="text-sm font-medium">Branded customer proof PDF</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Analyse the attached source artwork, review preflight checks, then generate
          the Candid Creative branded PDF into 03 Proofs. Source artwork stays in its
          original Dropbox location.
          {hasCustomerProof
            ? " This version already has a generated PDF. Use Create revised proof to start the next version with new artwork."
            : ""}
        </p>
      </div>

      <dl className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Source artwork</dt>
          <dd className="font-medium">{sourceArtwork?.file_name ?? "Not attached"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Customer proof</dt>
          <dd className="font-medium">
            {customerProof?.file_name ?? "Not generated yet"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dropbox location</dt>
          <dd>{customerProof ? "03 Proofs" : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Generated</dt>
          <dd>{formatTimestamp(proof.brandedPdfGeneratedAt) ?? "—"}</dd>
        </div>
      </dl>

      {panelError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {panelError}
        </p>
      ) : null}

      {successMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {successMessage}
        </p>
      ) : null}

      {hasCustomerProof ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadCustomerProof}>
            View/download generated proof
          </Button>
        </div>
      ) : null}

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
              disabled={pending || generating}
              onClick={() => void analyseArtwork()}
            >
              Analyse artwork & review preflight
            </Button>
          )}
        </div>
      ) : null}

      {step === "review" && preflight ? (
        <ProofPreflightReview
          preflight={preflight}
          pending={pending || generating}
          generating={generating}
          warningsReviewed={warningsReviewed}
          onWarningsReviewedChange={setWarningsReviewed}
          onCancel={() => {
            setStep("idle");
            setPreflight(null);
            setWarningsReviewed({});
          }}
          onReanalyse={() => void analyseArtwork()}
          onGenerate={(confirmation) => void generateBrandedPdf(confirmation)}
        />
      ) : null}

      {hasAttachment && !hasCustomerProof ? (
        <p className="text-xs text-amber-800">
          Generate the branded customer proof PDF before sending this proof to the customer.
        </p>
      ) : null}
    </div>
  );
}
