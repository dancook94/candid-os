"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  confidenceLabel,
  formatCandidateSourceLabel,
} from "@/lib/proof-generator/production-features";
import type {
  PreflightCheck,
  PreflightOperatorConfirmation,
  PreflightResult,
} from "@/lib/proof-generator/types";

function mapCheckStatusToBadge(status: PreflightCheck["status"]) {
  switch (status) {
    case "pass":
      return "approved" as const;
    case "warning":
      return "pending" as const;
    case "fail":
      return "declined" as const;
    case "manual_review":
      return "declined" as const;
    default:
      return "draft" as const;
  }
}

function statusLabel(status: PreflightCheck["status"]) {
  switch (status) {
    case "pass":
      return "Pass";
    case "warning":
      return "Warning";
    case "fail":
      return "Fail";
    case "manual_review":
      return "Review";
    default:
      return "Info";
  }
}

type ProofPreflightReviewProps = {
  preflight: PreflightResult;
  pending: boolean;
  warningsReviewed: Record<string, boolean>;
  onWarningsReviewedChange: (value: Record<string, boolean>) => void;
  onCancel: () => void;
  onReanalyse: () => void;
  onGenerate: (confirmation: PreflightOperatorConfirmation) => void;
};

export function ProofPreflightReview({
  preflight,
  pending,
  warningsReviewed,
  onWarningsReviewedChange,
  onCancel,
  onReanalyse,
  onGenerate,
}: ProofPreflightReviewProps) {
  const [selectedCutPath, setSelectedCutPath] = useState<string>("");
  const [cutPathDecision, setCutPathDecision] = useState<
    "confirmed" | "no_cut_required" | "required_not_detected" | undefined
  >();
  const [showCutPathOnProof, setShowCutPathOnProof] = useState(false);
  const [selectedWhiteInk, setSelectedWhiteInk] = useState("");
  const [whiteInkDecision, setWhiteInkDecision] = useState<
    "confirmed" | "not_required" | undefined
  >();
  const [missingLinkOverrideReason, setMissingLinkOverrideReason] = useState("");
  const [checklist, setChecklist] = useState<
    NonNullable<PreflightOperatorConfirmation["checklist"]>
  >({});

  const artworkChecks = useMemo(
    () =>
      preflight.checks.filter((check) =>
        ["size_scale", "aspect_ratio", "orientation", "page_count", "colour_mode", "rgb_content", "cmyk_content", "bleed_box", "artwork_resolution", "effective_resolution", "file_metadata"].includes(
          check.key
        )
      ),
    [preflight.checks]
  );

  const productionChecks = useMemo(
    () =>
      preflight.checks.filter((check) =>
        [
          "cut_path_candidates",
          "cut_path_expected",
          "white_ink_candidates",
          "spot_colours",
          "production_separations",
          "other_spot_colours",
          "ai_preflight_unavailable",
        ].includes(check.key)
      ),
    [preflight.checks]
  );

  const fontChecks = useMemo(
    () => preflight.checks.filter((check) => check.key === "live_fonts"),
    [preflight.checks]
  );

  const imageChecks = useMemo(
    () =>
      preflight.checks.filter((check) =>
        ["embedded_images", "missing_linked_artwork"].includes(check.key)
      ),
    [preflight.checks]
  );

  const reviewChecks = useMemo(
    () =>
      preflight.checks.filter(
        (check) =>
          check.status === "warning" ||
          check.status === "manual_review" ||
          check.status === "fail"
      ),
    [preflight.checks]
  );

  const missingLinkFail = preflight.checks.some(
    (check) => check.key === "missing_linked_artwork" && check.status === "fail"
  );

  function buildConfirmation(): PreflightOperatorConfirmation {
    const confirmation: PreflightOperatorConfirmation = {
      checklist,
      missingLinkOverrideReason: missingLinkOverrideReason.trim() || null,
    };

    if (cutPathDecision) {
      const candidate = preflight.productionFeatures.cutPathCandidates.find(
        (entry) => entry.name === selectedCutPath
      );

      confirmation.cutPath = {
        decision: cutPathDecision,
        confirmedCandidateName:
          cutPathDecision === "confirmed" ? candidate?.name ?? selectedCutPath : null,
        confirmedSourceType:
          cutPathDecision === "confirmed" ? candidate?.sourceType ?? null : null,
        showOnCustomerProof:
          cutPathDecision === "confirmed" &&
          showCutPathOnProof &&
          preflight.productionFeatures.cutPathOverlayAvailable,
      };
    }

    if (whiteInkDecision) {
      const candidate = preflight.productionFeatures.whiteInkCandidates.find(
        (entry) => entry.name === selectedWhiteInk
      );

      confirmation.whiteInk = {
        decision: whiteInkDecision,
        confirmedCandidateName:
          whiteInkDecision === "confirmed" ? candidate?.name ?? selectedWhiteInk : null,
        confirmedSourceType:
          whiteInkDecision === "confirmed" ? candidate?.sourceType ?? null : null,
      };
    }

    return confirmation;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Preflight analysis</span>
        <StatusBadge
          status={
            preflight.overallStatus === "pass"
              ? "approved"
              : preflight.overallStatus === "warning"
                ? "pending"
                : "declined"
          }
          label={
            preflight.overallStatus === "pass"
              ? "Pass"
              : preflight.overallStatus === "warning"
                ? "Warnings"
                : preflight.overallStatus === "fail"
                  ? "Action required"
                  : "Manual review required"
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Artwork specification">
          <CheckList checks={artworkChecks} />
        </Section>

        <Section title="Production features">
          <CheckList checks={productionChecks} />
          {preflight.productionFeatures.layers.length > 0 ? (
            <details className="mt-3 rounded-md border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Detected layers / separations
              </summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {preflight.productionFeatures.layers.map((layer) => (
                  <li key={`${layer.sourceType}:${layer.name}`}>
                    {layer.name} — {formatCandidateSourceLabel(layer.sourceType)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Section>

        <Section title="Fonts">
          <p className="text-sm text-muted-foreground">{preflight.fonts.message}</p>
          <CheckList checks={fontChecks} />
        </Section>

        <Section title="Images">
          <p className="text-sm text-muted-foreground">{preflight.images.message}</p>
          <CheckList checks={imageChecks} />
        </Section>
      </div>

      {preflight.metadata.inputType !== "ai_unsupported" ? (
        <div className="space-y-4 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Candid confirmation</p>

          {(preflight.productionFeatures.cutPathCandidates.length > 0 ||
            preflight.productionFeatures.expectsCutPath) && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Cut path</p>
              {preflight.productionFeatures.cutPathCandidates.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Detected candidates</p>
                  {preflight.productionFeatures.cutPathCandidates.map((candidate) => (
                    <label
                      key={candidate.name}
                      className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="cutPathCandidate"
                        checked={selectedCutPath === candidate.name}
                        onChange={() => setSelectedCutPath(candidate.name)}
                      />
                      <span>
                        <span className="font-medium">{candidate.name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {formatCandidateSourceLabel(candidate.sourceType)} ·{" "}
                          {confidenceLabel(candidate.confidence)} confidence
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No cut path candidates detected.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={cutPathDecision === "confirmed" ? "default" : "outline"}
                  onClick={() => setCutPathDecision("confirmed")}
                >
                  Confirm selected cut path
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={cutPathDecision === "no_cut_required" ? "default" : "outline"}
                  onClick={() => setCutPathDecision("no_cut_required")}
                >
                  No cut line required
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    cutPathDecision === "required_not_detected" ? "default" : "outline"
                  }
                  onClick={() => setCutPathDecision("required_not_detected")}
                >
                  Cut line required but not detected
                </Button>
              </div>

              {cutPathDecision === "confirmed" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showCutPathOnProof}
                    disabled={!preflight.productionFeatures.cutPathOverlayAvailable}
                    onChange={(event) => setShowCutPathOnProof(event.target.checked)}
                  />
                  Show cut path on customer proof
                </label>
              ) : null}

              {preflight.productionFeatures.cutPathOverlayAvailable ? (
                <p className="text-xs text-emerald-700">Visual overlay available</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {preflight.productionFeatures.cutPathOverlayReason ??
                    "Visual overlay unavailable"}
                </p>
              )}

              {cutPathDecision === "confirmed" &&
              showCutPathOnProof &&
              !preflight.productionFeatures.cutPathOverlayAvailable ? (
                <p className="text-xs text-amber-700">
                  Cut path confirmation will appear as text only. Vector overlay cannot be rendered
                  from this artwork.
                </p>
              ) : null}
            </div>
          )}

          {preflight.productionFeatures.whiteInkCandidates.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">White ink</p>
              <div className="space-y-2">
                {preflight.productionFeatures.whiteInkCandidates.map((candidate) => (
                  <label
                    key={candidate.name}
                    className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="whiteInkCandidate"
                      checked={selectedWhiteInk === candidate.name}
                      onChange={() => setSelectedWhiteInk(candidate.name)}
                    />
                    <span>
                      <span className="font-medium">{candidate.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        — {formatCandidateSourceLabel(candidate.sourceType)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={whiteInkDecision === "confirmed" ? "default" : "outline"}
                  onClick={() => setWhiteInkDecision("confirmed")}
                >
                  Confirm white ink
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={whiteInkDecision === "not_required" ? "default" : "outline"}
                  onClick={() => setWhiteInkDecision("not_required")}
                >
                  No white ink required
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium">Operator checklist</p>
            {[
              ["bleed_trim_checked", "Bleed / trim checked"],
              ["spelling_content_checked", "Spelling / content checked"],
              ["material_specification_checked", "Material / specification checked"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(checklist[key as keyof typeof checklist])}
                  onChange={(event) =>
                    setChecklist((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {missingLinkFail ? (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <Label htmlFor="missingLinkOverride">Override reason for missing linked artwork</Label>
          <Textarea
            id="missingLinkOverride"
            value={missingLinkOverrideReason}
            onChange={(event) => setMissingLinkOverrideReason(event.target.value)}
            rows={2}
            placeholder="Required before generating when missing links are detected."
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Automated checks requiring acknowledgement</p>
        <div className="space-y-2">
          {reviewChecks.map((check) => (
            <div
              key={check.key}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <StatusBadge
                  status={mapCheckStatusToBadge(check.status)}
                  label={`${statusLabel(check.status)} · ${check.label}`}
                />
                <p className="mt-2 text-muted-foreground">{check.message}</p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(warningsReviewed[check.key])}
                  onChange={(event) =>
                    onWarningsReviewedChange({
                      ...warningsReviewed,
                      [check.key]: event.target.checked,
                    })
                  }
                />
                Reviewed
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onReanalyse}
        >
          Re-analyse
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => onGenerate(buildConfirmation())}
        >
          Generate branded proof PDF
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function CheckList({ checks }: { checks: PreflightCheck[] }) {
  if (!checks.length) {
    return <p className="text-muted-foreground">No checks in this section.</p>;
  }

  return (
    <ul className="space-y-2 text-muted-foreground">
      {checks.map((check) => (
        <li key={check.key}>
          <span className="font-medium text-foreground">{statusLabel(check.status)}</span>
          {" · "}
          {check.label}: {check.message}
        </li>
      ))}
    </ul>
  );
}
