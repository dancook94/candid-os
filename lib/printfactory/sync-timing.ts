export type SyncStageName =
  | "api_request"
  | "api_parse"
  | "pagination"
  | "normalization"
  | "database_upsert"
  | "parent_job_matching"
  | "item_suggestions"
  | "activity_logging"
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
