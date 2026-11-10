import type { SupabaseClient } from "@supabase/supabase-js";

import { quoteRequiresInstallation } from "@/lib/installations/classification";
import { formatLondonWhen } from "@/lib/installations/labels";

export type InstallationLineSignal = {
  isOptional: boolean;
  isSelected: boolean | null;
  requiresPrintSupply: boolean;
  requiresDelivery: boolean;
  requiresInstallation: boolean;
  workClass: string | null;
  title?: string | null;
};

export type InstallationVisitSignal = {
  status: string;
  scheduledStartAt: string | null;
};

export type InstallationJobSignal = {
  required: boolean;
  projectId: string | null;
  scheduleLabel: string | null;
  missingProject: boolean;
  showManagementLink: boolean;
};

const CLOSED_VISIT = new Set(["cancelled", "failed"]);

export function isOutstandingInstallationSnag(status: string | null | undefined) {
  return status === "open" || status === "in_progress";
}

export function installationScheduleLabel(visits: readonly InstallationVisitSignal[]) {
  const scheduled = visits.filter(
    (visit) => visit.scheduledStartAt && !CLOSED_VISIT.has(visit.status)
  );

  if (scheduled.length === 0) {
    return null;
  }

  const sorted = [...scheduled].sort((left, right) =>
    String(left.scheduledStartAt).localeCompare(String(right.scheduledStartAt))
  );
  const now = Date.now();
  const upcoming = sorted.find(
    (visit) => new Date(String(visit.scheduledStartAt)).getTime() >= now
  );
  const chosen = upcoming ?? sorted[sorted.length - 1];
  return formatLondonWhen(chosen.scheduledStartAt);
}

export function deriveInstallationJobSignal(input: {
  lines: readonly InstallationLineSignal[];
  projectId: string | null;
  visits: readonly InstallationVisitSignal[];
  canReadInstallations: boolean;
}): InstallationJobSignal {
  const requiredByQuote = quoteRequiresInstallation(
    input.lines.map((line) => {
      const flagged =
        line.requiresPrintSupply || line.requiresDelivery || line.requiresInstallation;
      return {
        isOptional: line.isOptional,
        isSelected: line.isSelected,
        workClass: line.workClass,
        requirements: flagged
          ? {
              printSupply: line.requiresPrintSupply,
              delivery: line.requiresDelivery,
              installation: line.requiresInstallation,
            }
          : null,
      };
    })
  );
  const projectId = input.projectId;
  const required = requiredByQuote || Boolean(projectId);

  return {
    required,
    projectId,
    scheduleLabel: projectId
      ? installationScheduleLabel(input.visits) ?? "Not scheduled"
      : null,
    missingProject: requiredByQuote && !projectId && input.canReadInstallations,
    showManagementLink: Boolean(projectId) && input.canReadInstallations,
  };
}

export function installationCardText(signal: InstallationJobSignal) {
  if (!signal.required) {
    return null;
  }

  if (!signal.scheduleLabel) {
    return "INSTALL";
  }

  return `INSTALL · ${signal.scheduleLabel}`;
}

type QuoteItemRow = {
  quote_version_id?: string | null;
  requires_print_supply?: boolean | null;
  requires_delivery?: boolean | null;
  requires_installation?: boolean | null;
  work_class?: string | null;
  is_optional?: boolean | null;
  is_selected?: boolean | null;
  title?: string | null;
};

type ProjectRow = {
  id?: string;
  job_id?: string | null;
  installation_visits?: Array<{
    status?: string | null;
    scheduled_start_at?: string | null;
  }> | null;
};

function lineFromRow(row: QuoteItemRow): InstallationLineSignal {
  return {
    isOptional: Boolean(row.is_optional),
    isSelected: row.is_selected ?? null,
    requiresPrintSupply: Boolean(row.requires_print_supply),
    requiresDelivery: Boolean(row.requires_delivery),
    requiresInstallation: Boolean(row.requires_installation),
    workClass: row.work_class ?? null,
    title: row.title ?? null,
  };
}

export async function loadInstallationJobSignal(
  admin: SupabaseClient,
  input: {
    jobId: string;
    quoteVersionId: string | null;
    canReadInstallations: boolean;
  }
): Promise<InstallationJobSignal> {
  const signals = await loadInstallationBoardSignals(admin, [
    { id: input.jobId, quoteVersionId: input.quoteVersionId },
  ], input.canReadInstallations);

  return (
    signals.get(input.jobId) ??
    deriveInstallationJobSignal({
      lines: [],
      projectId: null,
      visits: [],
      canReadInstallations: input.canReadInstallations,
    })
  );
}

export async function loadInstallationBoardSignals(
  admin: SupabaseClient,
  jobs: readonly { id: string; quoteVersionId: string | null }[],
  canReadInstallations: boolean
) {
  const signals = new Map<string, InstallationJobSignal>();
  const jobIds = jobs.map((job) => job.id);
  const versionIds = [
    ...new Set(jobs.map((job) => job.quoteVersionId).filter((id): id is string => Boolean(id))),
  ];

  const linesByVersion = new Map<string, InstallationLineSignal[]>();
  const projectByJob = new Map<
    string,
    { id: string; visits: InstallationVisitSignal[] }
  >();

  if (jobIds.length > 0) {
    const { data: projects, error: projectError } = await admin
      .from("installation_projects")
      .select("id, job_id, installation_visits(status, scheduled_start_at)")
      .in("job_id", jobIds);

    if (!projectError) {
      for (const row of (projects ?? []) as ProjectRow[]) {
        if (!row.job_id || !row.id) {
          continue;
        }
        projectByJob.set(row.job_id, {
          id: row.id,
          visits: (row.installation_visits ?? []).map((visit) => ({
            status: visit.status || "unscheduled",
            scheduledStartAt: visit.scheduled_start_at ?? null,
          })),
        });
      }
    }
  }

  if (versionIds.length > 0) {
    const { data: items, error: itemError } = await admin
      .from("quote_items")
      .select(
        "quote_version_id, title, requires_print_supply, requires_delivery, requires_installation, work_class, is_optional, is_selected"
      )
      .in("quote_version_id", versionIds);

    if (!itemError) {
      for (const row of (items ?? []) as QuoteItemRow[]) {
        const versionId = row.quote_version_id;
        if (!versionId) {
          continue;
        }
        const existing = linesByVersion.get(versionId) ?? [];
        existing.push(lineFromRow(row));
        linesByVersion.set(versionId, existing);
      }
    }
  }

  for (const job of jobs) {
    const project = projectByJob.get(job.id) ?? null;
    signals.set(
      job.id,
      deriveInstallationJobSignal({
        lines: job.quoteVersionId ? linesByVersion.get(job.quoteVersionId) ?? [] : [],
        projectId: project?.id ?? null,
        visits: project?.visits ?? [],
        canReadInstallations,
      })
    );
  }

  return signals;
}
