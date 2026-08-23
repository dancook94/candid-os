import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminArtworkSourceLabel } from "@/lib/jobs/artwork-source";
import { calculateProductionReadiness } from "@/lib/manifest/readiness";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import { mapCustomerProofStatusToBadge } from "@/lib/proofs/customer-state";
import type { CustomerProofStatus } from "@/lib/proofs/customer-state";
import { loadProductionBoardProofContextsByJobId } from "@/lib/proofs/loaders";
import {
  JOB_BOARD_SELECT,
  JOB_PRODUCTION_BOARD_COLUMNS,
  JOB_PRODUCTION_BOARD_STAGE_LABELS,
  JOB_BOARD_ACTIVITY_TYPES,
  type JobProductionBoardStage,
} from "@/lib/production/job-board-constants";
import { ProductionError } from "@/lib/production/errors";
import { computeDeadlineFlags } from "@/lib/production/board";
import type { ProductionBoardFilters } from "@/lib/production/types";
import { isPrintFactoryJobRipped } from "@/lib/printfactory/ripped";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";

export type JobProductionBoardCard = {
  id: string;
  job_reference: string;
  project_name: string;
  company_id: string;
  company_name: string;
  production_board_stage: JobProductionBoardStage;
  status: string;
  fulfilment_method: string | null;
  required_date: string | null;
  artwork_status_label: string;
  readiness_label: string;
  readiness_satisfied: number;
  readiness_active: number;
  readiness_is_ready: boolean;
  ripped_requirements_count: number;
  files_detected_count: number;
  priority_label: string | null;
  assigned_staff_name: string | null;
  proof_status_label: string;
  proof_status: CustomerProofStatus;
  proof_status_badge: ReturnType<typeof mapCustomerProofStatusToBadge>;
  readiness_unresolved_details: string[];
  synology_path_hint: string | null;
  dropbox_folder_path: string | null;
  dropbox_setup_status: string;
  opportunity_id: string | null;
  quote_id: string;
  updated_at: string;
  is_overdue: boolean;
  is_due_today: boolean;
  is_due_tomorrow: boolean;
  is_on_hold: boolean;
};

export type JobProductionBoardData = {
  columns: Record<JobProductionBoardStage, JobProductionBoardCard[]>;
  counts: Record<JobProductionBoardStage, number>;
  totalCount: number;
};

function emptyJobBoardData(): JobProductionBoardData {
  const columns = {} as Record<JobProductionBoardStage, JobProductionBoardCard[]>;
  const counts = {} as Record<JobProductionBoardStage, number>;

  for (const stage of JOB_PRODUCTION_BOARD_COLUMNS) {
    columns[stage] = [];
    counts[stage] = 0;
  }

  columns.on_hold = [];
  counts.on_hold = 0;

  return {
    columns,
    counts,
    totalCount: 0,
  };
}

export async function fetchJobProductionBoard(
  adminClient: SupabaseClient,
  filters: ProductionBoardFilters
) {
  let query = adminClient
    .from("jobs")
    .select(`${JOB_BOARD_SELECT}, companies(company_name)`)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false });

  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }

  if (filters.jobReference) {
    query = query.ilike("job_reference", `%${filters.jobReference}%`);
  }

  const { data: jobs, error } = await query.limit(500);

  if (error) {
    if (error.code === "42703") {
      return {
        data: null,
        queryError: "migration_required" as const,
        detail: error.message,
      };
    }

    return {
      data: null,
      queryError: "query_failed" as const,
      detail: error.message,
    };
  }

  const jobRows = jobs ?? [];
  const jobIds = jobRows.map((job) => job.id as string);

  const { data: manifestItems, error: manifestError } = jobIds.length
    ? await adminClient
        .from("production_items")
        .select(MANIFEST_ITEM_SELECT)
        .in("job_id", jobIds)
        .is("deleted_at", null)
    : { data: [], error: null };

  if (manifestError) {
    return {
      data: null,
      queryError: "query_failed" as const,
      detail: manifestError.message,
    };
  }

  const itemsByJob = new Map<string, typeof manifestItems>();

  for (const item of manifestItems ?? []) {
    const jobId = item.job_id as string;
    const existing = itemsByJob.get(jobId) ?? [];
    existing.push(item);
    itemsByJob.set(jobId, existing);
  }

  const { data: printfactoryCounts, error: pfCountError } = jobIds.length
    ? await adminClient
        .from("printfactory_jobs")
        .select("candid_job_id")
        .in("candid_job_id", jobIds)
        .in("job_match_status", ["matched_automatically", "matched_manually"])
    : { data: [], error: null };

  if (pfCountError && pfCountError.code !== "42P01") {
    return {
      data: null,
      queryError: "query_failed" as const,
      detail: pfCountError.message,
    };
  }

  const filesDetectedByJob = new Map<string, number>();

  for (const row of printfactoryCounts ?? []) {
    const jobId = row.candid_job_id as string;
    filesDetectedByJob.set(jobId, (filesDetectedByJob.get(jobId) ?? 0) + 1);
  }

  const searchTerm = filters.search.toLowerCase();

  const profileIds = new Set<string>();

  for (const item of manifestItems ?? []) {
    if (item.assigned_to_profile_id) {
      profileIds.add(item.assigned_to_profile_id as string);
    }
  }

  const profileNameById = new Map<string, string>();

  if (profileIds.size > 0) {
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .in("id", [...profileIds]);

    for (const profile of profiles ?? []) {
      profileNameById.set(profile.id as string, (profile.full_name as string) ?? "Staff");
    }
  }

  const proofContexts = await loadProductionBoardProofContextsByJobId(
    adminClient,
    jobRows.map((job) => ({
      id: job.id as string,
      job_reference: job.job_reference as string,
      project_name: job.project_name as string,
      proof_required: job.proof_required as boolean | null | undefined,
    }))
  );

  const cards: JobProductionBoardCard[] = jobRows
    .map((job) => {
      const items = itemsByJob.get(job.id as string) ?? [];
      const proofContext = proofContexts.get(job.id as string);
      const proofState = proofContext?.proofState ?? {
        status: "preparing" as const,
        label: "Proof being prepared",
        requiresCustomerAction: false,
        activeProofId: null,
        version: null,
        awaitingApprovalCount: 0,
        changesRequestedCount: 0,
        changesRequestedComment: null,
        cardActionLabel: null,
        cardActionUrl: null,
        awaitingApprovalProofs: [],
      };
      const coverage = proofContext?.coverage ?? {
        proofRequired: true,
        proofRequiredItemIds: new Set<string>(),
        satisfiedItemIds: new Set<string>(),
        pendingDecisionItemIds: new Set<string>(),
        coveredItemIds: new Set<string>(),
        hasWholeJobApprovedCoverage: false,
        requiredCount: 0,
        satisfiedCount: 0,
        pendingDecisionCount: 0,
      };

      const readiness = calculateProductionReadiness(items as never[], {
        hasOverride: Boolean(job.ready_to_print_override_at),
        proofCoverage: coverage,
        proofStatus: proofState.status,
        proofStatusLabel: proofContext?.boardLabel ?? proofState.label,
        proofs: proofContext?.proofs ?? [],
        proofLinks: proofContext?.proofLinks ?? [],
      });

      const rippedCount = items.filter(
        (item) =>
          item.printfactory_satisfied &&
          item.production_requirement_status === "required"
      ).length;

      const priorityItem = items
        .filter((item) => item.priority && item.priority !== "normal")
        .sort((a, b) => {
          const rank = (value: string) =>
            value === "urgent" ? 0 : value === "high" ? 1 : 2;
          return rank(String(a.priority)) - rank(String(b.priority));
        })[0];

      const assignedItem = items.find((item) => item.assigned_to_profile_id);
      const synologyItem = items.find((item) => item.synology_source_path);

      const deadlineFlags = computeDeadlineFlags(
        job.required_date ? `${job.required_date}T12:00:00.000Z` : null,
        job.production_board_stage === "complete_job" ? "completed" : "printing"
      );

      const companyRaw = job.companies as unknown;
      const companyData = Array.isArray(companyRaw) ? companyRaw[0] : companyRaw;
      const company = companyData as { company_name: string } | null | undefined;

      return {
        id: job.id as string,
        job_reference: job.job_reference as string,
        project_name: job.project_name as string,
        company_id: job.company_id as string,
        company_name: company?.company_name ?? "Unknown company",
        production_board_stage:
          (job.production_board_stage as JobProductionBoardStage) ??
          "accepted_quotes",
        status: job.status as string,
        fulfilment_method: job.fulfilment_method as string | null,
        required_date: job.required_date as string | null,
        artwork_status_label: getAdminArtworkSourceLabel(
          job.artwork_source as Parameters<typeof getAdminArtworkSourceLabel>[0]
        ),
        readiness_label: readiness.label,
        readiness_satisfied: readiness.satisfiedCount,
        readiness_active: readiness.activeRequiredCount,
        readiness_is_ready: readiness.isReady,
        ripped_requirements_count: rippedCount,
        files_detected_count: filesDetectedByJob.get(job.id as string) ?? 0,
        priority_label: priorityItem?.priority
          ? String(priorityItem.priority)
          : null,
        assigned_staff_name: assignedItem?.assigned_to_profile_id
          ? profileNameById.get(assignedItem.assigned_to_profile_id as string) ?? null
          : null,
        proof_status_label: proofContext?.boardLabel ?? proofState.label,
        proof_status: proofState.status,
        proof_status_badge: mapCustomerProofStatusToBadge(proofState.status),
        readiness_unresolved_details: readiness.unresolvedDetails ?? [],
        synology_path_hint: (synologyItem?.synology_source_path as string | null) ?? null,
        dropbox_folder_path: job.dropbox_folder_path as string | null,
        dropbox_setup_status: job.dropbox_setup_status as string,
        opportunity_id: job.opportunity_id as string | null,
        quote_id: job.quote_id as string,
        updated_at: job.updated_at as string,
        ...deadlineFlags,
        is_on_hold:
          job.production_board_stage === "on_hold" ||
          Boolean(job.production_board_on_hold),
        _items: items,
        _artwork_source: job.artwork_source as string,
      };
    })
    .filter((card) => {
      if (filters.dueDate === "overdue" && !card.is_overdue) {
        return false;
      }

      if (filters.dueDate === "today" && !card.is_due_today) {
        return false;
      }

      if (filters.dueDate === "tomorrow" && !card.is_due_tomorrow) {
        return false;
      }

      if (filters.assignedToProfileId) {
        const items = card._items as Array<{ assigned_to_profile_id?: string | null }>;
        const hasStaff = items.some(
          (item) => item.assigned_to_profile_id === filters.assignedToProfileId
        );

        if (!hasStaff) {
          return false;
        }
      }

      if (filters.priority) {
        const items = card._items as Array<{ priority?: string | null }>;
        const hasPriority = items.some((item) => item.priority === filters.priority);

        if (!hasPriority && card.priority_label !== filters.priority) {
          return false;
        }
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        card.job_reference,
        card.project_name,
        card.company_name,
        card.readiness_label,
        card.priority_label,
        card.assigned_staff_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    })
    .map(({ _items, _artwork_source: _artworkSource, ...card }) => card);

  const boardData = emptyJobBoardData();

  for (const card of cards) {
    const stage = card.is_on_hold ? "on_hold" : card.production_board_stage;
    const column = boardData.columns[stage] ?? boardData.columns.on_hold;
    column.push(card);
    boardData.counts[stage] = (boardData.counts[stage] ?? 0) + 1;
    boardData.totalCount += 1;
  }

  return {
    data: boardData,
    queryError: null as null,
    detail: null as null,
  };
}

export async function applyJobProductionBoardStageChange(
  adminClient: SupabaseClient,
  jobId: string,
  newStage: JobProductionBoardStage,
  actorProfileId: string,
  reason?: string | null
) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(JOB_BOARD_SELECT)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  if (!job) {
    throw new ProductionError("Job not found.", 404);
  }

  const previousStage = (job.production_board_stage ??
    "accepted_quotes") as JobProductionBoardStage;

  if (previousStage === newStage) {
    return { job, changed: false as const };
  }

  if (
    newStage !== "ready_to_print" &&
    previousStage === "accepted_quotes" &&
    newStage !== "on_hold"
  ) {
    throw new ProductionError(
      "Job must reach Ready to Print before moving through production stages.",
      400
    );
  }

  const { data: updated, error: updateError } = await adminClient
    .from("jobs")
    .update({
      production_board_stage: newStage,
      production_board_on_hold: newStage === "on_hold",
      ready_to_print_at:
        newStage === "ready_to_print" && !job.ready_to_print_at
          ? new Date().toISOString()
          : job.ready_to_print_at,
    })
    .eq("id", jobId)
    .select(JOB_BOARD_SELECT)
    .single();

  if (updateError) {
    throw new ProductionError(updateError.message, 500);
  }

  await adminClient.from("job_production_board_stage_history").insert({
    job_id: jobId,
    previous_stage: previousStage,
    new_stage: newStage,
    changed_by_profile_id: actorProfileId,
    change_reason: reason?.trim() || null,
    is_automatic: false,
  });

  const stageLabel = JOB_PRODUCTION_BOARD_STAGE_LABELS[newStage];

  await createCrmActivity(adminClient, {
    companyId: job.company_id as string,
    contactId: job.contact_id as string | null,
    opportunityId: job.opportunity_id as string | null,
    quoteId: job.quote_id as string,
    activityType: JOB_BOARD_ACTIVITY_TYPES.stageChanged,
    description: `Job ${job.job_reference} moved to ${stageLabel}.`,
    actorProfileId,
    metadata: {
      job_id: jobId,
      previous_stage: previousStage,
      new_stage: newStage,
      reason: reason?.trim() || null,
    },
    validatedLinks: {
      companyId: job.company_id as string,
      contactId: job.contact_id as string | null,
      opportunityId: job.opportunity_id as string | null,
      quoteId: job.quote_id as string,
      taskId: null,
    },
  });

  return {
    job: updated,
    changed: true as const,
    previousStage,
    newStage,
    previousLabel: JOB_PRODUCTION_BOARD_STAGE_LABELS[previousStage],
    newLabel: JOB_PRODUCTION_BOARD_STAGE_LABELS[newStage],
  };
}

export function isValidJobProductionBoardStage(
  value: string
): value is JobProductionBoardStage {
  return (
    value === "accepted_quotes" ||
    value === "ready_to_print" ||
    value === "printed" ||
    value === "laminating" ||
    value === "finishing" ||
    value === "cutting" ||
    value === "dispatch" ||
    value === "complete_job" ||
    value === "on_hold"
  );
}

export { isPrintFactoryJobRipped };
