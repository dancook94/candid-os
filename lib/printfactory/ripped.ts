import {
  DEFAULT_PRINTFACTORY_RIPPED_STATUSES,
} from "@/lib/printfactory/constants";

export type PrintfactoryRippableRecord = {
  printfactory_status: string | null;
  progress: number | null;
  ignored_at?: string | null;
  job_match_status?: string | null;
};

function loadRippedStatusValues() {
  const override = process.env.PRINTFACTORY_RIPPED_STATUSES?.trim();

  if (!override) {
    return DEFAULT_PRINTFACTORY_RIPPED_STATUSES.map((value) => value.toLowerCase());
  }

  return override
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const RIPPED_STATUS_VALUES = loadRippedStatusValues();

const NON_RIPPED_STATUS_VALUES = new Set([
  "hold",
  "onhold",
  "waiting",
  "received",
  "receiving",
  "ripping",
  "processing",
  "error",
  "failed",
  "cancelled",
  "canceled",
  "ignored",
  "deleted",
  "new",
  "pending",
]);

export type PrintfactoryRippedCheckOptions = {
  /** When true, ignored match status does not suppress ripped detection (e.g. matching queue UI). */
  allowIgnored?: boolean;
};

/**
 * A PrintFactory job counts as ripped when its status indicates post-RIP readiness.
 * Status values are matched case-insensitively against DEFAULT_PRINTFACTORY_RIPPED_STATUSES
 * or PRINTFACTORY_RIPPED_STATUSES env override.
 */
export function isPrintFactoryJobRipped(
  record: PrintfactoryRippableRecord,
  options?: PrintfactoryRippedCheckOptions
): boolean {
  if (!options?.allowIgnored) {
    if (record.ignored_at) {
      return false;
    }

    if (record.job_match_status === "ignored") {
      return false;
    }
  }

  const status = record.printfactory_status?.trim().toLowerCase() ?? "";

  if (!status) {
    return false;
  }

  if (NON_RIPPED_STATUS_VALUES.has(status)) {
    return false;
  }

  if (RIPPED_STATUS_VALUES.includes(status)) {
    return true;
  }

  // Some PrintFactory deployments prefix statuses, e.g. "Job.Ripped"
  const tail = status.split(/[./]/).pop() ?? status;

  if (RIPPED_STATUS_VALUES.includes(tail)) {
    return true;
  }

  return false;
}

export function getPrintfactoryRippedStatusDocumentation() {
  return {
    rippedStatuses: RIPPED_STATUS_VALUES,
    nonRippedStatuses: [...NON_RIPPED_STATUS_VALUES],
    envOverride: "PRINTFACTORY_RIPPED_STATUSES",
  };
}
