import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  allocateNextJobNumber,
  buildJobReferenceFromNumber,
} from "@/lib/jobs/allocate-job-number";
import { JobError } from "@/lib/jobs/errors";
import {
  type JobBillingType,
  resolveCommercialStatusForBillingType,
} from "@/lib/jobs/billing-types";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import type { JobRecord } from "@/lib/jobs/types";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import { generateAdditionalItemReference } from "@/lib/manifest/item-reference";
import { logManifestActivity, MANIFEST_ACTIVITY_TYPES } from "@/lib/manifest/activity";
import { PRINTFACTORY_ACTIVITY_TYPES } from "@/lib/printfactory/constants";
import { logPrintfactoryActivity } from "@/lib/printfactory/activity";
import { manuallyMatchPrintfactoryJob } from "@/lib/printfactory/job-matching";
import { confirmPrintfactoryItemLink } from "@/lib/printfactory/readiness-service";
import { ProductionError } from "@/lib/production/errors";
import { deriveCustomerSafeStatus } from "@/lib/production/status-sync";

export type CreateJobFromPrintfactoryInput = {
  printfactoryJobId: string;
  billingType: JobBillingType;
  projectName: string;
  companyId?: string | null;
  requiredDate?: string | null;
  notes?: string | null;
  actorProfileId: string;
};

function resolveInitialProductionItemSourceType(billingType: JobBillingType) {
  switch (billingType) {
    case "internal":
      return "internal" as const;
    case "non_billable":
      return "manual" as const;
    default:
      return "external" as const;
  }
}

function resolveInitialBillingStatus(billingType: JobBillingType) {
  switch (billingType) {
    case "billable":
      return "price_required" as const;
    case "non_billable":
      return "no_charge" as const;
    default:
      return "no_charge" as const;
  }
}

async function resolveCompanyId(
  adminClient: SupabaseClient,
  billingType: JobBillingType,
  companyId?: string | null
): Promise<string> {
  if (companyId?.trim()) {
    const { data, error } = await adminClient
      .from("companies")
      .select("id")
      .eq("id", companyId.trim())
      .maybeSingle();

    if (error) {
      throw new ProductionError(error.message, 500);
    }

    if (!data) {
      throw new ProductionError("Selected company was not found.", 404);
    }

    return data.id as string;
  }

  if (billingType === "internal") {
    const configuredId = process.env.CANDID_INTERNAL_COMPANY_ID?.trim();

    if (configuredId) {
      return configuredId;
    }

    const { data, error } = await adminClient
      .from("companies")
      .select("id, company_name")
      .ilike("company_name", "%Candid Creative%")
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new ProductionError(error.message, 500);
    }

    if (data?.id) {
      return data.id as string;
    }
  }

  throw new ProductionError(
    billingType === "internal"
      ? "Select a company or configure CANDID_INTERNAL_COMPANY_ID for internal jobs."
      : "A customer company is required for this job type.",
    400
  );
}

export async function createJobFromPrintfactoryRecord(
  adminClient: SupabaseClient,
  input: CreateJobFromPrintfactoryInput
) {
  const projectName = input.projectName.trim();

  if (!projectName) {
    throw new ProductionError("Project name is required.", 400);
  }

  const { data: pfJob, error: pfError } = await adminClient
    .from("printfactory_jobs")
    .select("*")
    .eq("id", input.printfactoryJobId)
    .maybeSingle();

  if (pfError) {
    throw new ProductionError(pfError.message, 500);
  }

  if (!pfJob) {
    throw new ProductionError("PrintFactory job not found.", 404);
  }

  if (pfJob.candid_job_id) {
    throw new ProductionError("PrintFactory job is already linked to a Candid job.", 400);
  }

  if (pfJob.job_match_status === "ignored") {
    throw new ProductionError("Ignored PrintFactory records must be un-ignored before creating a job.", 400);
  }

  const companyId = await resolveCompanyId(
    adminClient,
    input.billingType,
    input.companyId
  );

  const jobNumber = await allocateNextJobNumber(adminClient);
  const jobReference = buildJobReferenceFromNumber(jobNumber);
  const now = new Date().toISOString();
  const commercialStatus = resolveCommercialStatusForBillingType(input.billingType);

  const pfCreatedAt =
    (pfJob.created_at_printfactory as string | null) ??
    (pfJob.first_seen_at as string | null) ??
    now;

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .insert({
      company_id: companyId,
      quote_id: null,
      quote_version_id: null,
      opportunity_id: null,
      quote_request_id: null,
      contact_id: null,
      job_reference: jobReference,
      project_name: projectName,
      status: "in_production",
      fulfilment_method: null,
      required_date: input.requiredDate?.trim() || null,
      artwork_required: false,
      artwork_source: "manual_receipt",
      proof_required: false,
      customer_visible: input.billingType === "billable",
      accepted_at: now,
      accepted_by: input.actorProfileId,
      dropbox_setup_status: "pending",
      production_board_stage: "ready_to_print",
      commercial_status: commercialStatus,
      job_billing_type: input.billingType,
      job_origin: "printfactory",
      internal_notes: input.notes?.trim() || null,
    })
    .select(JOB_LIST_COLUMNS)
    .single();

  if (jobError || !job) {
    if (jobError?.message?.includes("job_billing_type")) {
      throw new ProductionError(
        "Standalone job columns are missing. Apply migration 20260903140000_printfactory_matching_go_live_standalone_jobs.sql.",
        503
      );
    }

    throw new ProductionError(jobError?.message ?? "Unable to create job.", 500);
  }

  const typedJob = job as JobRecord & {
    job_billing_type?: JobBillingType;
    job_origin?: string;
  };

  const itemTitle =
    pfJob.job_name?.trim() ||
    pfJob.document_name?.trim() ||
    pfJob.source_file_name?.trim() ||
    projectName;

  const itemReference = await generateAdditionalItemReference(
    adminClient,
    typedJob.id,
    typedJob.job_reference
  );

  const sourceType = resolveInitialProductionItemSourceType(input.billingType);
  const billingStatus = resolveInitialBillingStatus(input.billingType);

  const { data: item, error: itemError } = await adminClient
    .from("production_items")
    .insert({
      job_id: typedJob.id,
      company_id: companyId,
      quote_id: null,
      quote_version_id: null,
      item_reference: itemReference,
      item_name: itemTitle,
      description:
        pfJob.normalized_source_path ??
        pfJob.source_file_path ??
        pfJob.document_name ??
        null,
      source_type: sourceType,
      billing_status: billingStatus,
      production_requirement_status: "required",
      requires_printfactory: true,
      machine: pfJob.device,
      material: pfJob.media_type,
      synology_source_path:
        pfJob.normalized_source_path ?? pfJob.source_file_path ?? null,
      printfactory_job_guid: pfJob.printfactory_job_guid,
      production_status: "printing",
      customer_safe_status: deriveCustomerSafeStatus("printing"),
      internal_note: input.notes?.trim() || null,
      required_at: input.requiredDate?.trim() || null,
    })
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (itemError || !item) {
    throw new ProductionError(itemError?.message ?? "Unable to create production item.", 500);
  }

  await manuallyMatchPrintfactoryJob(
    adminClient,
    input.printfactoryJobId,
    typedJob.id,
    input.actorProfileId
  );

  await confirmPrintfactoryItemLink(
    adminClient,
    input.printfactoryJobId,
    item.id as string,
    input.actorProfileId
  );

  await createCrmActivity(adminClient, {
    companyId,
    contactId: null,
    opportunityId: null,
    quoteId: null,
    activityType: "job_created",
    description: `Job ${typedJob.job_reference} created from PrintFactory (${input.billingType}).`,
    actorProfileId: input.actorProfileId,
    metadata: {
      job_id: typedJob.id,
      printfactory_job_id: input.printfactoryJobId,
      billing_type: input.billingType,
      pf_created_at: pfCreatedAt,
    },
    validatedLinks: {
      companyId,
      contactId: null,
      opportunityId: null,
      quoteId: null,
      taskId: null,
    },
  });

  await logManifestActivity(adminClient, {
    activityType: MANIFEST_ACTIVITY_TYPES.productionItemAdded,
    description: `Production item "${itemTitle}" created from PrintFactory on ${typedJob.job_reference}.`,
    companyId,
    jobId: typedJob.id,
    productionItemId: item.id as string,
    actorProfileId: input.actorProfileId,
    metadata: { source_type: sourceType, billing_status: billingStatus },
  });

  await logPrintfactoryActivity(adminClient, {
    activityType: PRINTFACTORY_ACTIVITY_TYPES.jobMatched,
    description: `PrintFactory job linked to newly created ${typedJob.job_reference}.`,
    companyId,
    jobId: typedJob.id,
    actorProfileId: input.actorProfileId,
    metadata: {
      printfactory_job_id: input.printfactoryJobId,
      created_from_printfactory: true,
      billing_type: input.billingType,
    },
  });

  return {
    job: typedJob,
    productionItem: item,
    jobReference: typedJob.job_reference,
    redirectPath: `/admin/jobs/${typedJob.id}`,
  };
}

export async function searchJobsForPrintfactoryMatching(
  adminClient: SupabaseClient,
  query: string,
  limit = 20
) {
  const term = query.trim();

  if (term.length < 1) {
    return [];
  }

  const escaped = term.replace(/[%_,]/g, "");
  const pattern = `%${escaped}%`;

  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "id, job_reference, project_name, status, company_id, job_billing_type, companies(company_name)"
    )
    .neq("status", "cancelled")
    .or(`job_reference.ilike.${pattern},project_name.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (error.message.includes("job_billing_type")) {
      const { data: fallbackData, error: fallbackError } = await adminClient
        .from("jobs")
        .select("id, job_reference, project_name, status, company_id, companies(company_name)")
        .neq("status", "cancelled")
        .or(`job_reference.ilike.${pattern},project_name.ilike.${pattern}`)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (fallbackError) {
        throw new JobError(fallbackError.message, 500);
      }

      return (fallbackData ?? []).map((row) => ({
        id: row.id as string,
        jobReference: row.job_reference as string,
        projectName: row.project_name as string,
        companyName:
          (Array.isArray(row.companies)
            ? row.companies[0]?.company_name
            : (row.companies as { company_name?: string } | null)?.company_name) ??
          "Unknown company",
        billingType: null as JobBillingType | null,
      }));
    }

    throw new JobError(error.message, 500);
  }

  const companyMatches =
    escaped.length >= 2
      ? await adminClient
          .from("companies")
          .select("id, company_name")
          .ilike("company_name", pattern)
          .limit(10)
      : { data: [], error: null };

  if (companyMatches.error) {
    throw new JobError(companyMatches.error.message, 500);
  }

  const companyIds = (companyMatches.data ?? []).map((row) => row.id as string);
  let companyJobRows: typeof data = [];

  if (companyIds.length > 0) {
    const { data: byCompany, error: byCompanyError } = await adminClient
      .from("jobs")
      .select(
        "id, job_reference, project_name, status, company_id, job_billing_type, companies(company_name)"
      )
      .neq("status", "cancelled")
      .in("company_id", companyIds)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (byCompanyError) {
      throw new JobError(byCompanyError.message, 500);
    }

    companyJobRows = byCompany ?? [];
  }

  const merged = new Map<string, (typeof data)[number]>();

  for (const row of [...(data ?? []), ...companyJobRows]) {
    merged.set(row.id as string, row);
  }

  return [...merged.values()].slice(0, limit).map((row) => ({
    id: row.id as string,
    jobReference: row.job_reference as string,
    projectName: row.project_name as string,
    companyName:
      (Array.isArray(row.companies)
        ? row.companies[0]?.company_name
        : (row.companies as { company_name?: string } | null)?.company_name) ??
      "Unknown company",
    billingType: (row.job_billing_type as JobBillingType | null | undefined) ?? null,
  }));
}
