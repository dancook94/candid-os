import type {
  PreflightOperatorConfirmation,
  PreflightResult,
  ProductionFeatureCandidate,
  ProductionFeaturesResult,
} from "@/lib/proof-generator/types";

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

  return errors;
}
