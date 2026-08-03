import type { SupabaseClient } from "@supabase/supabase-js";

import {
  logManifestActivity,
  MANIFEST_ACTIVITY_TYPES,
} from "@/lib/manifest/activity";
import {
  isLikelyNonPrintLine,
  MANIFEST_ITEM_SELECT,
} from "@/lib/manifest/constants";
import type { ManifestSourceType } from "@/lib/manifest/constants";
import { calculateProductionReadiness } from "@/lib/manifest/readiness";
import type {
  CancelManifestItemInput,
  ManifestItemFormInput,
  ManifestItemRecord,
  ManifestReconcileResult,
} from "@/lib/manifest/types";
import { ProductionError, isMissingManifestSchemaError, isMissingProductionSchemaError } from "@/lib/production/errors";
import { deriveCustomerSafeStatus } from "@/lib/production/status-sync";
import {
  generateItemReferenceForSourceType,
  generateQuotedItemReference,
  reconcileMissingItemReferences,
} from "@/lib/manifest/item-reference";
import type { ProductionStatus } from "@/lib/production/constants";

type QuoteItemRow = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  is_optional: boolean;
  sort_order: number;
};

type JobRow = {
  id: string;
  company_id: string;
  quote_id: string;
  quote_version_id: string | null;
  opportunity_id: string | null;
  contact_id: string | null;
  job_reference: string;
  ready_to_print_override_at: string | null;
};

async function loadJob(adminClient: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, quote_version_id, opportunity_id, contact_id, job_reference, ready_to_print_override_at"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  if (!data) {
    throw new ProductionError("Job not found.", 404);
  }

  return data as JobRow;
}

export async function loadAcceptedQuoteItems(
  adminClient: SupabaseClient,
  quoteVersionId: string
): Promise<QuoteItemRow[]> {
  return loadQuoteItems(adminClient, quoteVersionId);
}

async function loadQuoteItems(
  adminClient: SupabaseClient,
  quoteVersionId: string
): Promise<QuoteItemRow[]> {
  const { data, error } = await adminClient
    .from("quote_items")
    .select(
      "id, title, description, quantity, unit_price, line_total, is_optional, sort_order"
    )
    .eq("quote_version_id", quoteVersionId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  return (data ?? []) as QuoteItemRow[];
}

function defaultRequirementForQuoteLine(title: string) {
  if (isLikelyNonPrintLine(title)) {
    return {
      production_requirement_status: "not_required" as const,
      requires_printfactory: false,
      billing_status: "billable" as const,
    };
  }

  return {
    production_requirement_status: "required" as const,
    requires_printfactory: false,
    billing_status: "billable" as const,
  };
}

async function reconcileManifestQuoteItemLinks(
  adminClient: SupabaseClient,
  jobId: string,
  quoteItems: QuoteItemRow[]
) {
  const { data: manifestItems, error } = await adminClient
    .from("production_items")
    .select("id, item_name, quote_item_id, source_type")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  const linkedQuoteItemIds = new Set(
    (manifestItems ?? [])
      .map((item) => item.quote_item_id)
      .filter((id): id is string => Boolean(id))
  );

  for (const manifestItem of manifestItems ?? []) {
    if (manifestItem.source_type !== "quoted" || manifestItem.quote_item_id) {
      continue;
    }

    const titleMatches = quoteItems.filter(
      (quoteItem) =>
        quoteItem.title.trim().toLowerCase() ===
        String(manifestItem.item_name).trim().toLowerCase()
    );

    if (titleMatches.length !== 1) {
      continue;
    }

    const candidate = titleMatches[0];

    if (linkedQuoteItemIds.has(candidate.id)) {
      continue;
    }

    const { error: updateError } = await adminClient
      .from("production_items")
      .update({ quote_item_id: candidate.id })
      .eq("id", manifestItem.id);

    if (updateError) {
      throw new ProductionError(updateError.message, 500);
    }

    linkedQuoteItemIds.add(candidate.id);
  }
}

export async function loadManifestItemsForJob(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingProductionSchemaError(error) || isMissingManifestSchemaError(error)) {
      return { items: [], schemaMissing: true as const, manifestMigrationMissing: isMissingManifestSchemaError(error) };
    }

    throw new ProductionError(error.message, 500);
  }

  return {
    items: (data ?? []) as ManifestItemRecord[],
    schemaMissing: false as const,
    manifestMigrationMissing: false as const,
  };
}

export async function reconcileProductionManifestForJob(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
): Promise<ManifestReconcileResult> {
  const job = await loadJob(adminClient, jobId);

  if (!job.quote_version_id) {
    return {
      created: 0,
      skipped: 0,
      totalQuoteItems: 0,
      schemaMissing: false,
      error: "No accepted quote version linked to this job.",
    };
  }

  const quoteItems = await loadQuoteItems(adminClient, job.quote_version_id);

  if (quoteItems.length === 0) {
    return {
      created: 0,
      skipped: 0,
      totalQuoteItems: 0,
      schemaMissing: false,
      error: null,
    };
  }

  try {
    await reconcileManifestQuoteItemLinks(adminClient, jobId, quoteItems);
  } catch {
    // Link repair is best-effort; manifest reconcile proceeds.
  }

  const { data: existingItems, error: existingError } = await adminClient
    .from("production_items")
    .select("id, quote_item_id")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (existingError) {
    if (isMissingProductionSchemaError(existingError)) {
      return {
        created: 0,
        skipped: 0,
        totalQuoteItems: quoteItems.length,
        schemaMissing: true,
        error: existingError.message,
      };
    }

    throw new ProductionError(existingError.message, 500);
  }

  const existingQuoteItemIds = new Set(
    (existingItems ?? [])
      .map((item) => item.quote_item_id)
      .filter((id): id is string => Boolean(id))
  );

  let created = 0;
  let skipped = 0;

  for (const quoteItem of quoteItems) {
    if (quoteItem.is_optional) {
      skipped += 1;
      continue;
    }

    if (existingQuoteItemIds.has(quoteItem.id)) {
      skipped += 1;
      continue;
    }

    const defaults = defaultRequirementForQuoteLine(quoteItem.title);
    const itemReference = await generateQuotedItemReference(
      adminClient,
      jobId,
      job.job_reference
    );

    const { error: insertError } = await adminClient.from("production_items").insert({
      job_id: jobId,
      company_id: job.company_id,
      quote_id: job.quote_id,
      quote_version_id: job.quote_version_id,
      quote_item_id: quoteItem.id,
      item_reference: itemReference,
      item_name: quoteItem.title,
      description: quoteItem.description,
      quantity: quoteItem.quantity,
      quoted_quantity: quoteItem.quantity,
      quote_unit_price: quoteItem.unit_price,
      unit: "each",
      source_type: "quoted",
      production_status: "artwork",
      customer_safe_status: deriveCustomerSafeStatus("artwork"),
      ...defaults,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        skipped += 1;
        continue;
      }

      throw new ProductionError(insertError.message, 500);
    }

    created += 1;
  }

  if (created > 0) {
    try {
      await logManifestActivity(adminClient, {
        activityType: MANIFEST_ACTIVITY_TYPES.productionManifestCreated,
        description: `Production manifest reconciled for ${job.job_reference}: ${created} item(s) created, ${skipped} skipped.`,
        companyId: job.company_id,
        quoteId: job.quote_id,
        jobId: job.id,
        opportunityId: job.opportunity_id,
        contactId: job.contact_id,
        actorProfileId: actorProfileId ?? null,
        metadata: { created, skipped, total_quote_items: quoteItems.length },
      });
    } catch {
      // Non-critical.
    }
  }

  return {
    created,
    skipped,
    totalQuoteItems: quoteItems.length,
    schemaMissing: false,
    error: null,
  };
}

export async function ensureProductionManifestForJob(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
) {
  return reconcileProductionManifestForJob(adminClient, jobId, actorProfileId);
}

export async function getJobProductionReadiness(
  adminClient: SupabaseClient,
  jobId: string
) {
  const job = await loadJob(adminClient, jobId);
  const { items } = await loadManifestItemsForJob(adminClient, jobId);

  return calculateProductionReadiness(items, {
    hasOverride: Boolean(job.ready_to_print_override_at),
  });
}

export async function addManifestItem(
  adminClient: SupabaseClient,
  jobId: string,
  input: ManifestItemFormInput & { sourceType?: ManifestSourceType },
  actorProfileId: string
) {
  const job = await loadJob(adminClient, jobId);
  const sourceType = input.sourceType ?? "additional";
  const billingStatus =
    input.billingStatus ??
    (sourceType === "reprint" ? "reprint_no_charge" : "price_required");

  const itemReference = await generateItemReferenceForSourceType(
    adminClient,
    jobId,
    job.job_reference,
    sourceType
  );

  const productionStatus = input.productionStatus ?? "artwork";

  const { data: item, error } = await adminClient
    .from("production_items")
    .insert({
      job_id: jobId,
      company_id: job.company_id,
      quote_id: job.quote_id,
      quote_version_id: job.quote_version_id,
      item_reference: itemReference,
      item_name: input.itemName.trim(),
      description: input.description?.trim() || null,
      quantity: input.quantity ?? null,
      unit: input.unit?.trim() || "each",
      material: input.material?.trim() || null,
      machine: input.machine?.trim() || null,
      width_mm: input.widthMm ?? null,
      height_mm: input.heightMm ?? null,
      internal_note: input.internalNote?.trim() || null,
      source_type: sourceType,
      billing_status: billingStatus,
      production_requirement_status:
        input.productionRequirementStatus ?? "required",
      requires_printfactory: input.requiresPrintfactory ?? false,
      production_status: productionStatus,
      customer_safe_status: deriveCustomerSafeStatus(productionStatus),
    })
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to add manifest item.", 500);
  }

  await logManifestActivity(adminClient, {
    activityType: MANIFEST_ACTIVITY_TYPES.productionItemAdded,
    description: `Production manifest item "${input.itemName.trim()}" added to ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: item.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { source_type: sourceType, billing_status: billingStatus },
  });

  return item as ManifestItemRecord;
}

export async function updateManifestItem(
  adminClient: SupabaseClient,
  itemId: string,
  input: ManifestItemFormInput,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Manifest item not found.", 404);
  }

  const job = await loadJob(adminClient, existing.job_id);
  const productionStatus =
    input.productionStatus ?? (existing.production_status as ProductionStatus);

  const { data: item, error } = await adminClient
    .from("production_items")
    .update({
      item_name: input.itemName.trim(),
      description: input.description?.trim() || null,
      quantity: input.quantity ?? null,
      unit: input.unit?.trim() || existing.unit,
      material: input.material?.trim() || null,
      machine: input.machine?.trim() || null,
      width_mm: input.widthMm ?? null,
      height_mm: input.heightMm ?? null,
      internal_note: input.internalNote?.trim() || null,
      production_requirement_status:
        input.productionRequirementStatus ?? existing.production_requirement_status,
      billing_status: input.billingStatus ?? existing.billing_status,
      requires_printfactory:
        input.requiresPrintfactory ?? existing.requires_printfactory,
      production_status: productionStatus,
      customer_safe_status: deriveCustomerSafeStatus(productionStatus),
    })
    .eq("id", itemId)
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to update manifest item.", 500);
  }

  await logManifestActivity(adminClient, {
    activityType: MANIFEST_ACTIVITY_TYPES.productionItemReclassified,
    description: `Production manifest item "${input.itemName.trim()}" updated on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: itemId,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
  });

  return item as ManifestItemRecord;
}

export async function cancelManifestItemByCustomer(
  adminClient: SupabaseClient,
  itemId: string,
  input: CancelManifestItemInput,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Manifest item not found.", 404);
  }

  const job = await loadJob(adminClient, existing.job_id);
  const effectiveAt = input.effectiveAt ?? new Date().toISOString();

  const { data: item, error } = await adminClient
    .from("production_items")
    .update({
      production_requirement_status: "cancelled",
      billing_status: "cancelled",
      customer_change_reason: input.reason.trim(),
      customer_cancelled_at: effectiveAt,
      customer_cancelled_by: actorProfileId,
    })
    .eq("id", itemId)
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to cancel manifest item.", 500);
  }

  await logManifestActivity(adminClient, {
    activityType: MANIFEST_ACTIVITY_TYPES.productionItemCancelled,
    description: `Production manifest item "${existing.item_name}" cancelled by customer on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: itemId,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { reason: input.reason.trim(), effective_at: effectiveAt },
  });

  return item as ManifestItemRecord;
}

export async function reclassifyManifestItem(
  adminClient: SupabaseClient,
  itemId: string,
  action: string,
  actorProfileId: string,
  options?: { combineIntoItemId?: string; reason?: string }
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Manifest item not found.", 404);
  }

  const job = await loadJob(adminClient, existing.job_id);
  const updates: Record<string, unknown> = {};

  switch (action) {
    case "mark_not_required":
      updates.production_requirement_status = "not_required";
      break;
    case "mark_external":
      updates.production_requirement_status = "external";
      updates.source_type = "external";
      break;
    case "mark_manual_production":
      updates.production_requirement_status = "manual_production";
      updates.printfactory_satisfied = true;
      break;
    case "mark_no_charge_reprint":
      updates.source_type = "reprint";
      updates.billing_status = "reprint_no_charge";
      updates.production_requirement_status = "required";
      break;
    case "combine":
      if (!options?.combineIntoItemId) {
        throw new ProductionError("Target item is required to combine.", 400);
      }
      updates.production_requirement_status = "combined";
      updates.combined_into_item_id = options.combineIntoItemId;
      break;
    case "archive":
      updates.deleted_at = new Date().toISOString();
      break;
    case "requires_printfactory":
      updates.requires_printfactory = true;
      break;
    case "no_printfactory":
      updates.requires_printfactory = false;
      break;
    default:
      throw new ProductionError("Unknown manifest action.", 400);
  }

  const { data: item, error } = await adminClient
    .from("production_items")
    .update(updates)
    .eq("id", itemId)
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to update manifest item.", 500);
  }

  const activityType =
    action === "mark_no_charge_reprint"
      ? MANIFEST_ACTIVITY_TYPES.productionItemMarkedNoCharge
      : MANIFEST_ACTIVITY_TYPES.productionItemReclassified;

  await logManifestActivity(adminClient, {
    activityType,
    description: `Production manifest item "${existing.item_name}" reclassified (${action}) on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: itemId,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { action, reason: options?.reason ?? null },
  });

  return item as ManifestItemRecord;
}

export async function markJobReadyToPrintOverride(
  adminClient: SupabaseClient,
  jobId: string,
  reason: string,
  actorProfileId: string
) {
  const job = await loadJob(adminClient, jobId);
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("jobs")
    .update({
      ready_to_print_override_at: now,
      ready_to_print_override_by: actorProfileId,
      ready_to_print_override_reason: reason.trim(),
    })
    .eq("id", jobId);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  return { ok: true as const, overriddenAt: now };
}

export async function duplicateManifestItem(
  adminClient: SupabaseClient,
  itemId: string,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Manifest item not found.", 404);
  }

  const job = await loadJob(adminClient, existing.job_id);
  const itemReference = await generateItemReferenceForSourceType(
    adminClient,
    existing.job_id,
    job.job_reference,
    "manual"
  );

  const {
    id: _id,
    created_at: _ca,
    updated_at: _ua,
    completed_at: _co,
    item_reference: _ir,
    quote_item_id: _qi,
    customer_cancelled_at: _cca,
    customer_cancelled_by: _ccb,
    combined_into_item_id: _cii,
    ...rest
  } = existing as ManifestItemRecord;

  const { data: item, error } = await adminClient
    .from("production_items")
    .insert({
      ...rest,
      item_reference: itemReference,
      item_name: `${existing.item_name} (copy)`,
      quote_item_id: null,
      source_type: "manual",
      billing_status: "price_required",
      completed_at: null,
      customer_cancelled_at: null,
      customer_cancelled_by: null,
      combined_into_item_id: null,
    })
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to duplicate manifest item.", 500);
  }

  await logManifestActivity(adminClient, {
    activityType: MANIFEST_ACTIVITY_TYPES.productionItemAdded,
    description: `Production manifest item duplicated as "${item.item_name}" on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: item.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { duplicated_from: itemId },
  });

  return item as ManifestItemRecord;
}
