import type {
  PreflightOperatorConfirmation,
  PreflightResult,
  ProductionFeatureCandidate,
  ProductionFeaturesResult,
} from "@/lib/proof-generator/types";
import {
  resolvePreflightChecksAfterProductionConfirmation,
} from "@/lib/proof-generator/warnings";

function resolveOverallStatus(
  checks: PreflightResult["checks"]
): PreflightResult["overallStatus"] {
  const rank: Record<PreflightResult["overallStatus"], number> = {
    pass: 0,
    warning: 1,
    manual_review: 2,
    fail: 3,
  };

  return checks.reduce<PreflightResult["overallStatus"]>((worst, check) => {
    if (check.status === "info") {
      return worst;
    }

    const mapped =
      check.status === "pass"
        ? "pass"
        : check.status === "warning"
          ? "warning"
          : check.status === "fail"
            ? "fail"
            : "manual_review";

    return rank[mapped] > rank[worst] ? mapped : worst;
  }, "pass");
}

function findCandidate(
  candidates: ProductionFeatureCandidate[],
  name: string | null | undefined
) {
  if (!name) {
    return null;
  }

  return (
    candidates.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase()) ??
    null
  );
}

export function applyOperatorConfirmationToPreflight(
  preflight: PreflightResult,
  confirmation: PreflightOperatorConfirmation | undefined,
  actorProfileId: string
): PreflightResult {
  if (!confirmation) {
    return preflight;
  }

  const now = new Date().toISOString();
  const productionFeatures: ProductionFeaturesResult = {
    ...preflight.productionFeatures,
  };

  if (confirmation.cutPath?.decision === "confirmed") {
    const candidate = findCandidate(
      productionFeatures.cutPathCandidates,
      confirmation.cutPath.confirmedCandidateName
    );

    if (candidate) {
      productionFeatures.confirmedCutPath = {
        name: candidate.name,
        sourceType: candidate.sourceType,
        confirmedAt: now,
        confirmedByProfileId: actorProfileId,
        note: confirmation.cutPath.note ?? null,
      };
      productionFeatures.noCutLineRequired = false;
      productionFeatures.cutPathRequiredNotDetected = false;
      productionFeatures.showCutPathOnProof = Boolean(confirmation.cutPath.showOnCustomerProof);
    }
  } else if (confirmation.cutPath?.decision === "no_cut_required") {
    productionFeatures.noCutLineRequired = true;
    productionFeatures.cutPathRequiredNotDetected = false;
    productionFeatures.confirmedCutPath = null;
    productionFeatures.showCutPathOnProof = false;
  } else if (confirmation.cutPath?.decision === "required_not_detected") {
    productionFeatures.cutPathRequiredNotDetected = true;
    productionFeatures.noCutLineRequired = false;
    productionFeatures.confirmedCutPath = null;
    productionFeatures.showCutPathOnProof = false;
  }

  if (confirmation.whiteInk?.decision === "confirmed") {
    const candidate = findCandidate(
      productionFeatures.whiteInkCandidates,
      confirmation.whiteInk.confirmedCandidateName
    );

    if (candidate) {
      productionFeatures.confirmedWhiteInk = {
        name: candidate.name,
        sourceType: candidate.sourceType,
        confirmedAt: now,
        confirmedByProfileId: actorProfileId,
        note: confirmation.whiteInk.note ?? null,
      };
      productionFeatures.noWhiteInkRequired = false;
    }
  } else if (confirmation.whiteInk?.decision === "not_required") {
    productionFeatures.noWhiteInkRequired = true;
    productionFeatures.confirmedWhiteInk = null;
  }

  return {
    ...preflight,
    productionFeatures,
  };
}

export function resolvePreflightAfterOperatorConfirmation(
  preflight: PreflightResult,
  confirmation: PreflightOperatorConfirmation | undefined,
  actorProfileId: string
): PreflightResult {
  const withConfirmation = applyOperatorConfirmationToPreflight(
    preflight,
    confirmation,
    actorProfileId
  );
  const checks = resolvePreflightChecksAfterProductionConfirmation(
    withConfirmation.checks,
    withConfirmation.productionFeatures
  );

  return {
    ...withConfirmation,
    checks,
    overallStatus: resolveOverallStatus(checks),
  };
}

export function validateOperatorConfirmation(
  preflight: PreflightResult,
  confirmation: PreflightOperatorConfirmation | undefined
) {
  const errors: string[] = [];

  const needsCutPathDecision =
    preflight.productionFeatures.cutPathCandidates.length > 0 ||
    preflight.productionFeatures.expectsCutPath;

  if (needsCutPathDecision && !confirmation?.cutPath?.decision) {
    errors.push("Confirm the cut path decision before generating.");
  }

  if (
    confirmation?.cutPath?.decision === "confirmed" &&
    !confirmation.cutPath.confirmedCandidateName
  ) {
    errors.push("Select a cut path candidate to confirm.");
  }

  if (
    preflight.productionFeatures.whiteInkCandidates.length > 0 &&
    !confirmation?.whiteInk?.decision
  ) {
    errors.push("Confirm white ink requirements before generating.");
  }

  if (
    confirmation?.whiteInk?.decision === "confirmed" &&
    !confirmation.whiteInk.confirmedCandidateName
  ) {
    errors.push("Select a white ink candidate to confirm.");
  }

  const missingLinkCheck = preflight.checks.find(
    (check) => check.key === "missing_linked_artwork" && check.status === "fail"
  );

  if (missingLinkCheck && !confirmation?.missingLinkOverrideReason?.trim()) {
    errors.push(
      "Missing linked artwork must be resolved or overridden with an admin reason before generating."
    );
  }

  if (
    confirmation?.cutPath?.decision === "confirmed" &&
    confirmation.cutPath.showOnCustomerProof &&
    !preflight.productionFeatures.cutPathOverlayAvailable
  ) {
    errors.push(
      "Show cut path on proof is unavailable because vector geometry could not be extracted from this artwork."
    );
  }

  return errors;
}
