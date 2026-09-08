"use client";

import { isTestCommunicationModePublic } from "@/lib/communications/config";

export function CommunicationModeBanner() {
  if (!isTestCommunicationModePublic()) {
    return null;
  }

  return (
    <div
      className="border-b border-amber-300/60 bg-amber-50 px-6 py-2 text-center text-xs font-medium text-amber-950 lg:pl-[calc(17.5rem+1.5rem)]"
      role="status"
      aria-live="polite"
    >
      <span className="font-semibold uppercase tracking-[0.12em]">Test communications</span>
      <span className="mx-2 text-amber-700">·</span>
      Customer emails redirected internally
    </div>
  );
}

export function TestCommunicationHint() {
  if (!isTestCommunicationModePublic()) {
    return null;
  }

  return (
    <p className="text-xs text-amber-800">
      Test mode — email will be redirected internally.
    </p>
  );
}
