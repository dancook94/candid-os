import type { SupabaseClient } from "@supabase/supabase-js";

import { computeDeadlineFlags } from "@/lib/production/board";
import type { JobProductionBoardCard } from "@/lib/production/job-board-service";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeProductionDeadlineDate(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (!ISO_DATE_PATTERN.test(trimmed)) {
    throw new Error("Production deadline must be a valid date (YYYY-MM-DD).");
  }

  return trimmed;
}

export function resolveQuoteProductionDeadlineForSave(input: {
  quoteRequestId: string | null;
  productionDeadline: string | null | undefined;
}) {
  if (input.quoteRequestId) {
    return null;
  }

  return normalizeProductionDeadlineDate(input.productionDeadline);
}

export function resolveJobRequiredDateFromQuoteSources(input: {
  quoteRequestId: string | null;
  quoteRequestRequiredDate: string | null;
  quoteRequiredDate: string | null;
}) {
  if (input.quoteRequestId) {
    return input.quoteRequestRequiredDate;
  }

  return normalizeProductionDeadlineDate(input.quoteRequiredDate);
}

export function formatProductionBoardDeadline(dateString: string | null | undefined) {
  if (!dateString) {
    return "No deadline set";
  }

  const formatted = new Date(`${dateString}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return `Due: ${formatted}`;
}

export function formatJobProductionDeadline(dateString: string | null | undefined) {
  if (!dateString) {
    return "No production deadline set";
  }

  return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function requiredDateToDeadlineInput(requiredDate: string | null | undefined) {
  return requiredDate?.slice(0, 10) ?? "";
}

export function applyRequiredDateToJobBoardCard(
  card: JobProductionBoardCard,
  requiredDate: string | null
): JobProductionBoardCard {
  const deadlineFlags = computeDeadlineFlags(
    requiredDate ? `${requiredDate}T12:00:00.000Z` : null,
    card.production_board_stage === "complete_job" ? "completed" : "printing"
  );

  return {
    ...card,
    required_date: requiredDate,
    ...deadlineFlags,
  };
}

export async function updateJobRequiredDate(
  adminClient: SupabaseClient,
  jobId: string,
  requiredDate: string | null | undefined
) {
  const normalized = normalizeProductionDeadlineDate(requiredDate);

  const { data, error } = await adminClient
    .from("jobs")
    .update({ required_date: normalized })
    .eq("id", jobId)
    .select("id, required_date")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Job not found.");
  }

  return {
    jobId: data.id as string,
    requiredDate: (data.required_date as string | null) ?? null,
  };
}
