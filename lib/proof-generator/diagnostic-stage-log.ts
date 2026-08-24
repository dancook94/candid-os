type DiagnosticStageEntry = {
  stage: string;
  label: string;
  elapsedMs: number;
  detail?: Record<string, unknown>;
};

const stageStartedAt = new Map<string, number>();
const stageOrder: DiagnosticStageEntry[] = [];
let runStartedAt = Date.now();

export function resetDiagnosticStageLog() {
  stageStartedAt.clear();
  stageOrder.length = 0;
  runStartedAt = Date.now();
}

export function logDiagnosticStage(
  stage: string,
  label: string,
  detail?: Record<string, unknown>
) {
  const now = Date.now();
  const elapsedMs = now - runStartedAt;
  stageStartedAt.set(stage, now);
  stageOrder.push({ stage, label, elapsedMs, detail });

  if (process.env.NODE_ENV !== "production") {
    const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
    console.info(
      `[proof-gen-diagnostic] ${stage} ${label} +${elapsedMs}ms${suffix}`
    );
  }
}

export function getDiagnosticStageLog() {
  return [...stageOrder];
}

export function getLastDiagnosticStage() {
  return stageOrder.at(-1) ?? null;
}
