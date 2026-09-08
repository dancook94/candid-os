export type SyncStageName =
  | "api_request"
  | "api_parse"
  | "pagination"
  | "normalization"
  | "detail_fetch"
  | "database_upsert"
  | "parent_job_matching"
  | "item_suggestions"
  | "activity_logging"
  | "sync_state_update"
  | "total";

export type SyncStageTiming = {
  stage: SyncStageName;
  elapsedMs: number;
  details?: Record<string, unknown>;
};

export class PrintfactorySyncStageTimer {
  private readonly startedAt = Date.now();
  private readonly stageStartedAt = new Map<SyncStageName, number>();
  private readonly timings: SyncStageTiming[] = [];

  start(stage: SyncStageName) {
    this.stageStartedAt.set(stage, Date.now());
  }

  end(stage: SyncStageName, details?: Record<string, unknown>) {
    const started = this.stageStartedAt.get(stage);

    if (started == null) {
      return;
    }

    this.timings.push({
      stage,
      elapsedMs: Date.now() - started,
      details,
    });
    this.stageStartedAt.delete(stage);
  }

  getTimings() {
    return [
      ...this.timings,
      {
        stage: "total" as const,
        elapsedMs: Date.now() - this.startedAt,
      },
    ];
  }

  logDevSummary(extra?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    console.info(
      "[printfactory sync timing]",
      JSON.stringify(
        {
          stages: this.getTimings(),
          ...extra,
        },
        null,
        2
      )
    );
  }
}

export function createSyncStageTimer() {
  return new PrintfactorySyncStageTimer();
}

function serializeSyncErrorField(value: unknown): unknown {
  if (value == null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/** @deprecated Prefer logSyncFailure from sync-errors.ts (logs in all environments). */
export function logSyncErrorDev(
  failingStage: SyncStageName | null,
  error: unknown
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const payload: Record<string, unknown> = {
    failingStage,
  };

  if (error instanceof Error) {
    payload.name = error.name;
    payload.message = error.message;
    payload.stack = error.stack;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;

    if (typeof record.message === "string") {
      payload.message = record.message;
    }

    if (typeof record.code === "string") {
      payload.code = record.code;
    }

    if ("details" in record) {
      payload.details = serializeSyncErrorField(record.details);
    }

    if (typeof record.hint === "string") {
      payload.hint = record.hint;
    }
  }

  if (payload.message == null && error != null) {
    payload.raw = serializeSyncErrorField(error);
  }

  console.error("[printfactory sync error]", JSON.stringify(payload, null, 2));
}
