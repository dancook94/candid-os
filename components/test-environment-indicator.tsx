import { isTestAppEnvironment } from "@/lib/app-env";

export function TestEnvironmentBanner() {
  if (!isTestAppEnvironment()) {
    return null;
  }

  return (
    <div
      className="sticky top-0 z-50 flex h-9 shrink-0 items-center justify-center border-b border-amber-300/60 bg-amber-50 px-4 text-center text-xs font-semibold uppercase tracking-[0.14em] text-amber-950"
      role="status"
    >
      TEST ENVIRONMENT — NOT LIVE
    </div>
  );
}

export function TestEnvironmentBadge() {
  if (!isTestAppEnvironment()) {
    return null;
  }

  return (
    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-950">
      TEST
    </span>
  );
}
