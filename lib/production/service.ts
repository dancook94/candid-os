import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminArtworkSourceLabel } from "@/lib/jobs/artwork-source";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import {
  PRODUCTION_ACTIVITY_TYPES,
  PRODUCTION_ITEM_SELECT,
  PRODUCTION_STATUS_LABELS,
} from "@/lib/production/constants";
import type { ProductionStatus } from "@/lib/production/constants";
import {
  buildStageChangedDescription,
  logProductionActivity,
} from "@/lib/production/activity";
import {
  computeDeadlineFlags,
  groupCardsIntoBoardData,
} from "@/lib/production/board";
import { ProductionError, isMissingProductionSchemaError } from "@/lib/production/errors";
import {
  canTransitionProductionStatus,
  deriveCustomerSafeStatus,
  deriveJobStatusFromProductionItems,
  isValidProductionStatus,
} from "@/lib/production/status-sync";
import type {
  ProductionBoardFilters,
  ProductionItemFormInput,
  ProductionItemRecord,
} from "@/lib/production/types";
import { createAdminClient } from "@/lib/supabase/admin";

type JobContext = {
  id: string;
  company_id: string;
  quote_id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  job_reference: string;
  project_name: string;
  status: string;
  artwork_source: string;
};

async function loadJobContext(
  adminClient: SupabaseClient,
  jobId: string
): Promise<JobContext> {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, contact_id, job_reference, project_name, status, artwork_source"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  if (!job) {
    throw new ProductionError("Job not found.", 404);
  }

  return job as JobContext;
}

async function generateItemReference(
  adminClient: SupabaseClient,
  jobId: string,
  jobReference: string
) {
  const { count, error } = await adminClient
    .from("production_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  const sequence = String((count ?? 0) + 1).padStart(2, "0");
  return `${jobReference}-${sequence}`;
}

function mapFormInputToRow(
  input: ProductionItemFormInput,
  productionStatus: ProductionStatus
) {
  return {
    item_name: input.itemName.trim(),
    description: input.description?.trim() || null,
    quantity: input.quantity ?? null,
    required_at: input.requiredAt || null,
    priority: input.priority ?? "normal",
    machine: input.machine?.trim() || null,
    material: input.material?.trim() || null,
    media_profile: input.mediaProfile?.trim() || null,
    width_mm: input.widthMm ?? null,
    height_mm: input.heightMm ?? null,
    copies: input.copies ?? null,
    sides: input.sides ?? null,
    finishing_notes: input.finishingNotes?.trim() || null,
    assigned_to_profile_id: input.assignedToProfileId ?? null,
    production_status: productionStatus,
    customer_safe_status: deriveCustomerSafeStatus(productionStatus),
    synology_source_path: input.synologySourcePath?.trim() || null,
  };
}

async function syncJobStatusFromItems(
  adminClient: SupabaseClient,
  job: JobContext,
  actorProfileId?: string | null
) {
  const { data: items, error } = await adminClient
    .from("production_items")
    .select("production_status")
    .eq("job_id", job.id)
    .is("deleted_at", null);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  const nextStatus = deriveJobStatusFromProductionItems(
    (items ?? []).map((item) => item.production_status as ProductionStatus)
  );

  if (!nextStatus || nextStatus === job.status) {
    return;
  }

  const protectedStatuses = ["cancelled", "completed"];

  if (protectedStatuses.includes(job.status)) {
    return;
  }

  const { error: updateError } = await adminClient
    .from("jobs")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  if (updateError) {
    throw new ProductionError(updateError.message, 500);
  }

  if (nextStatus === "completed") {
    try {
      const { ensureInvoiceDraftForJob } = await import("@/lib/invoice/service");
      await ensureInvoiceDraftForJob(adminClient, job.id, actorProfileId);
    } catch {
      // Non-critical.
    }
  }

  try {
    await logProductionActivity(adminClient, {
      activityType: "job_status_changed",
      description: `Job ${job.job_reference} status changed to ${JOB_STATUS_LABELS[nextStatus] ?? nextStatus} based on production items.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      jobId: job.id,
      productionItemId: "",
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
      actorProfileId: actorProfileId ?? null,
      metadata: {
        previous_status: job.status,
        new_status: nextStatus,
        trigger: "production_items_sync",
      },
    });
  } catch {
    // Non-critical.
  }
}

export async function fetchProductionBoard(
  adminClient: SupabaseClient,
  filters: ProductionBoardFilters
) {
  let query = adminClient
    .from("production_items")
    .select(PRODUCTION_ITEM_SELECT)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }

  if (filters.assignedToProfileId) {
    query = query.eq("assigned_to_profile_id", filters.assignedToProfileId);
  }

  if (filters.machine) {
    query = query.ilike("machine", `%${filters.machine}%`);
  }

  if (filters.material) {
    query = query.ilike("material", `%${filters.material}%`);
  }

  if (filters.priority) {
    query = query.eq("priority", filters.priority);
  }

  const { data: items, error } = await query;

  if (error) {
    if (isMissingProductionSchemaError(error)) {
      return {
        data: null,
        queryError: "migration_required" as const,
        detail: error.message,
      };
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[production board] query failed:", error.message);
    }

    return {
      data: null,
      queryError: "query_failed" as const,
      detail: error.message,
    };
  }

  const typedItems = (items ?? []) as ProductionItemRecord[];

  if (typedItems.length === 0) {
    return {
      data: groupCardsIntoBoardData([]),
      queryError: null,
      detail: null,
    };
  }

  const jobIds = [...new Set(typedItems.map((item) => item.job_id))];
  const companyIds = [...new Set(typedItems.map((item) => item.company_id))];
  const staffIds = [
    ...new Set(
      typedItems
        .map((item) => item.assigned_to_profile_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [jobsResult, companiesResult, staffResult] = await Promise.all([
    adminClient
      .from("jobs")
      .select("id, job_reference, project_name, status, artwork_source")
      .in("id", jobIds),
    adminClient.from("companies").select("id, company_name").in("id", companyIds),
    staffIds.length
      ? adminClient.from("profiles").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (jobsResult.error || companiesResult.error || staffResult.error) {
    const message =
      jobsResult.error?.message ??
      companiesResult.error?.message ??
      staffResult.error?.message ??
      "Unable to load production board.";

    return {
      data: null,
      queryError: "query_failed" as const,
      detail: message,
    };
  }

  const jobsById = new Map(
    (jobsResult.data ?? []).map((job) => [job.id as string, job])
  );
  const companiesById = new Map(
    (companiesResult.data ?? []).map((company) => [
      company.id as string,
      company.company_name as string,
    ])
  );
  const staffById = new Map(
    (staffResult.data ?? []).map((profile) => [
      profile.id as string,
      (profile.full_name as string | null)?.trim() || "Unnamed staff member",
    ])
  );

  const searchTerm = filters.search.toLowerCase();
  const jobRefFilter = filters.jobReference?.toLowerCase();

  const cards = typedItems
    .map((item) => {
      const job = jobsById.get(item.job_id);

      if (!job) {
        return null;
      }

      const deadlineFlags = computeDeadlineFlags(
        item.required_at,
        item.production_status
      );

      return {
        id: item.id,
        job_id: item.job_id,
        job_reference: job.job_reference as string,
        project_name: job.project_name as string,
        company_id: item.company_id,
        company_name: companiesById.get(item.company_id) ?? "Unknown company",
        item_reference: item.item_reference,
        item_name: item.item_name,
        description: item.description,
        quantity: item.quantity,
        production_status: item.production_status,
        priority: item.priority,
        required_at: item.required_at,
        assigned_to_profile_id: item.assigned_to_profile_id,
        assigned_to_name: item.assigned_to_profile_id
          ? staffById.get(item.assigned_to_profile_id) ?? null
          : null,
        machine: item.machine,
        material: item.material,
        artwork_status_label: getAdminArtworkSourceLabel(
          job.artwork_source as Parameters<typeof getAdminArtworkSourceLabel>[0]
        ),
        job_artwork_source: job.artwork_source as string,
        updated_at: item.updated_at,
        is_urgent: item.priority === "urgent",
        ...deadlineFlags,
      };
    })
    .filter((card): card is NonNullable<typeof card> => card !== null)
    .filter((card) => {
      if (jobRefFilter && !card.job_reference.toLowerCase().includes(jobRefFilter)) {
        return false;
      }

      if (filters.dueDate === "overdue" && !card.is_overdue) {
        return false;
      }

      if (filters.dueDate === "today" && !card.is_due_today) {
        return false;
      }

      if (filters.dueDate === "tomorrow" && !card.is_due_tomorrow) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        card.job_reference,
        card.project_name,
        card.company_name,
        card.item_name,
        card.item_reference,
        card.machine,
        card.material,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });

  return {
    data: groupCardsIntoBoardData(cards),
    queryError: null,
    detail: null,
  };
}

export async function loadProductionItemsForJob(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select(PRODUCTION_ITEM_SELECT)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingProductionSchemaError(error)) {
      return { items: [], schemaMissing: true as const };
    }

    throw new ProductionError(error.message, 500);
  }

  return {
    items: (data ?? []) as ProductionItemRecord[],
    schemaMissing: false as const,
  };
}

export async function createProductionItem(
  adminClient: SupabaseClient,
  jobId: string,
  input: ProductionItemFormInput,
  actorProfileId: string
) {
  const job = await loadJobContext(adminClient, jobId);
  const productionStatus = input.productionStatus ?? "artwork";

  if (!isValidProductionStatus(productionStatus)) {
    throw new ProductionError("Invalid production stage.", 400);
  }

  if (!input.itemName.trim()) {
    throw new ProductionError("Item name is required.", 400);
  }

  const itemReference = await generateItemReference(
    adminClient,
    jobId,
    job.job_reference
  );

  const row = {
    job_id: jobId,
    company_id: job.company_id,
    item_reference: itemReference,
    ...mapFormInputToRow(input, productionStatus),
    completed_at: productionStatus === "completed" ? new Date().toISOString() : null,
  };

  const { data: item, error } = await adminClient
    .from("production_items")
    .insert(row)
    .select(PRODUCTION_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to create production item.", 500);
  }

  await logProductionActivity(adminClient, {
    activityType: PRODUCTION_ACTIVITY_TYPES.productionItemCreated,
    description: `Production item "${input.itemName.trim()}" created for ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: item.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: {
      production_status: productionStatus,
      item_reference: itemReference,
    },
  });

  await syncJobStatusFromItems(adminClient, job, actorProfileId);

  return item as ProductionItemRecord;
}

export async function updateProductionItem(
  adminClient: SupabaseClient,
  itemId: string,
  input: ProductionItemFormInput,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(PRODUCTION_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Production item not found.", 404);
  }

  const job = await loadJobContext(adminClient, existing.job_id);
  const productionStatus =
    input.productionStatus ?? (existing.production_status as ProductionStatus);

  if (!isValidProductionStatus(productionStatus)) {
    throw new ProductionError("Invalid production stage.", 400);
  }

  if (!input.itemName.trim()) {
    throw new ProductionError("Item name is required.", 400);
  }

  const previousAssignee = existing.assigned_to_profile_id;
  const nextAssignee = input.assignedToProfileId ?? null;

  const updates = {
    ...mapFormInputToRow(input, productionStatus),
    completed_at:
      productionStatus === "completed"
        ? existing.completed_at ?? new Date().toISOString()
        : null,
  };

  const { data: item, error } = await adminClient
    .from("production_items")
    .update(updates)
    .eq("id", itemId)
    .select(PRODUCTION_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to update production item.", 500);
  }

  await logProductionActivity(adminClient, {
    activityType: PRODUCTION_ACTIVITY_TYPES.productionItemUpdated,
    description: `Production item "${input.itemName.trim()}" updated on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: itemId,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
  });

  if (previousAssignee !== nextAssignee) {
    await logProductionActivity(adminClient, {
      activityType: PRODUCTION_ACTIVITY_TYPES.productionItemAssigned,
      description: `Production item "${input.itemName.trim()}" assignment updated on ${job.job_reference}.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      jobId: job.id,
      productionItemId: itemId,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
      actorProfileId,
      metadata: {
        previous_assigned_to_profile_id: previousAssignee,
        new_assigned_to_profile_id: nextAssignee,
      },
    });
  }

  await syncJobStatusFromItems(adminClient, job, actorProfileId);

  return item as ProductionItemRecord;
}

export async function duplicateProductionItem(
  adminClient: SupabaseClient,
  itemId: string,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(PRODUCTION_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Production item not found.", 404);
  }

  const job = await loadJobContext(adminClient, existing.job_id);
  const itemReference = await generateItemReference(
    adminClient,
    existing.job_id,
    job.job_reference
  );

  const { id: _id, created_at: _ca, updated_at: _ua, completed_at: _co, item_reference: _ir, ...rest } =
    existing as ProductionItemRecord;

  const { data: item, error } = await adminClient
    .from("production_items")
    .insert({
      ...rest,
      item_reference: itemReference,
      item_name: `${existing.item_name} (copy)`,
      completed_at: null,
      production_status:
        existing.production_status === "completed"
          ? "ready_for_production"
          : existing.production_status,
      customer_safe_status:
        existing.production_status === "completed"
          ? deriveCustomerSafeStatus("ready_for_production")
          : existing.customer_safe_status,
    })
    .select(PRODUCTION_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to duplicate production item.", 500);
  }

  await logProductionActivity(adminClient, {
    activityType: PRODUCTION_ACTIVITY_TYPES.productionItemCreated,
    description: `Production item duplicated as "${item.item_name}" on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: item.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { duplicated_from: itemId },
  });

  await syncJobStatusFromItems(adminClient, job, actorProfileId);

  return item as ProductionItemRecord;
}

export async function archiveProductionItem(
  adminClient: SupabaseClient,
  itemId: string,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(PRODUCTION_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Production item not found.", 404);
  }

  const job = await loadJobContext(adminClient, existing.job_id);
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("production_items")
    .update({ deleted_at: now })
    .eq("id", itemId);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  await logProductionActivity(adminClient, {
    activityType: PRODUCTION_ACTIVITY_TYPES.productionItemUpdated,
    description: `Production item "${existing.item_name}" archived on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: itemId,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { archived: true },
  });

  await syncJobStatusFromItems(adminClient, job, actorProfileId);

  return { ok: true as const };
}

export async function applyProductionStageChange(
  adminClient: SupabaseClient,
  input: {
    itemId: string;
    newStage: ProductionStatus;
    previousStage: ProductionStatus;
    actorProfileId: string;
  }
) {
  if (!isValidProductionStatus(input.newStage)) {
    throw new ProductionError("Invalid production stage.", 400);
  }

  if (!isValidProductionStatus(input.previousStage)) {
    throw new ProductionError("Invalid previous stage.", 400);
  }

  if (input.newStage === input.previousStage) {
    return { ok: true as const, stage: input.newStage };
  }

  if (!canTransitionProductionStatus(input.previousStage, input.newStage)) {
    throw new ProductionError("This stage transition is not allowed.", 400);
  }

  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(PRODUCTION_ITEM_SELECT)
    .eq("id", input.itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Production item not found.", 404);
  }

  if (existing.production_status !== input.previousStage) {
    throw new ProductionError(
      "Production item stage has changed. Refresh the board and try again.",
      409
    );
  }

  const job = await loadJobContext(adminClient, existing.job_id);
  const customerSafeStatus = deriveCustomerSafeStatus(input.newStage);
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await adminClient
    .from("production_items")
    .update({
      production_status: input.newStage,
      customer_safe_status: customerSafeStatus,
      completed_at: input.newStage === "completed" ? now : null,
      updated_at: now,
    })
    .eq("id", input.itemId)
    .eq("production_status", input.previousStage)
    .select(PRODUCTION_ITEM_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new ProductionError(updateError.message, 500);
  }

  if (!updated) {
    throw new ProductionError(
      "Production item stage has changed. Refresh the board and try again.",
      409
    );
  }

  const activityType =
    input.newStage === "completed"
      ? PRODUCTION_ACTIVITY_TYPES.productionItemCompleted
      : input.newStage === "on_hold"
        ? PRODUCTION_ACTIVITY_TYPES.productionItemPutOnHold
        : PRODUCTION_ACTIVITY_TYPES.productionItemStageChanged;

  await logProductionActivity(adminClient, {
    activityType,
    description: buildStageChangedDescription({
      itemName: existing.item_name,
      jobReference: job.job_reference,
      previousStage: input.previousStage,
      newStage: input.newStage,
      previousLabel: PRODUCTION_STATUS_LABELS[input.previousStage],
      newLabel: PRODUCTION_STATUS_LABELS[input.newStage],
    }),
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: input.itemId,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId: input.actorProfileId,
    metadata: {
      previous_stage: input.previousStage,
      new_stage: input.newStage,
    },
  });

  await syncJobStatusFromItems(adminClient, job, input.actorProfileId);

  return { ok: true as const, stage: input.newStage };
}

export { createAdminClient };
