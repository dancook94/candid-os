import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import { loadManifestItemsForProofContext } from "@/lib/manifest/proof-requirement-service";
import {
  deriveCustomerProofState,
  isJobProofRequired,
  type CustomerProofActionItem,
  type CustomerProofState,
  type CustomerProofSummary,
} from "@/lib/proofs/customer-state";
import {
  buildProofCoverageContext,
  type ProofCoverageContext,
} from "@/lib/proofs/coverage";
import { deriveJobProofSummary } from "@/lib/proofs/job-proof-summary";
import { loadJobProofRequirement, loadProofsForJob } from "@/lib/proofs/service";
import type { ProofRecordForItemCoverage } from "@/lib/manifest/proof-requirement";

export type ProductionBoardProofContext = {
  proofState: CustomerProofState;
  proofRequired: boolean;
  coverage: ProofCoverageContext;
  boardLabel: string;
  manifestItems: ManifestItemRecord[];
  proofs: ProofRecordForItemCoverage[];
  proofLinks: Array<{ proof_id: string; production_item_id: string }>;
};

async function loadAllProofManifestLinks(
  adminClient: SupabaseClient,
  proofIds: string[]
) {
  if (proofIds.length === 0) {
    return [] as Array<{ proof_id: string; production_item_id: string }>;
  }

  const { data, error } = await adminClient
    .from("job_proof_manifest_items")
    .select("proof_id, production_item_id")
    .in("proof_id", proofIds);

  if (error) {
    return [];
  }

  return (data ?? []) as Array<{ proof_id: string; production_item_id: string }>;
}

function mapProofRows(proofs: Array<Record<string, unknown>>) {
  return proofs.map((proof) => ({
    id: proof.id as string,
    job_id: proof.job_id as string,
    proof_lineage_id: proof.proof_lineage_id as string,
    proof_reference: proof.proof_reference as string,
    version_number: proof.version_number as number,
    status: proof.status as string,
    title: proof.title as string,
    sent_at: (proof.sent_at as string | null) ?? null,
    changes_requested_comment: (proof.changes_requested_comment as string | null) ?? null,
    approved_at: (proof.approved_at as string | null) ?? null,
    customer_message: (proof.customer_message as string | null) ?? null,
    created_at: proof.created_at as string,
  }));
}

async function buildProofContextForJob(
  adminClient: SupabaseClient,
  job: {
    id: string;
    job_reference: string;
    project_name: string;
    proof_required?: boolean | null;
    proof_requirements_confirmed_at?: string | null;
  },
  manifestItems: ManifestItemRecord[],
  proofs: ProofRecordForItemCoverage[],
  links: Array<{ proof_id: string; production_item_id: string }>
): Promise<ProductionBoardProofContext> {
  const approvedProofIds = proofs
    .filter((proof) => proof.status === "approved")
    .map((proof) => proof.id);

  const summary = deriveJobProofSummary({
    manifestItems,
    proofs,
    links,
    jobId: job.id,
    jobReference: job.job_reference,
    projectName: job.project_name,
    proofRequirementsConfirmedAt: job.proof_requirements_confirmed_at,
    legacyProofRequired: job.proof_required,
  });

  const proofState = deriveCustomerProofState({
    proofRequired: summary.proofRequired,
    proofs: proofs as CustomerProofSummary[],
    jobId: job.id,
    jobReference: job.job_reference,
    projectName: job.project_name,
  });

  proofState.label = summary.label;
  proofState.status = summary.status;

  return {
    proofRequired: summary.proofRequired,
    proofState,
    boardLabel: summary.boardLabel,
    manifestItems,
    proofs,
    proofLinks: links,
    coverage: buildProofCoverageContext(summary.proofRequired, approvedProofIds, links, {
      manifestItems,
      proofs,
    }),
  };
}

export async function loadProductionBoardProofContextsByJobId(
  adminClient: SupabaseClient,
  jobs: Array<{
    id: string;
    job_reference: string;
    project_name: string;
    proof_required?: boolean | null;
    proof_requirements_confirmed_at?: string | null;
  }>
) {
  const contexts = new Map<string, ProductionBoardProofContext>();

  if (jobs.length === 0) {
    return contexts;
  }

  const jobIds = jobs.map((job) => job.id);

  const [{ data: proofs, error }, manifestByJob] = await Promise.all([
    adminClient
      .from("job_proofs")
      .select(
        "id, job_id, proof_lineage_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
      )
      .in("job_id", jobIds)
      .order("version_number", { ascending: false }),
    Promise.all(
      jobIds.map(async (jobId) => {
        const result = await loadManifestItemsForProofContext(adminClient, jobId);
        return [jobId, result.items] as const;
      })
    ),
  ]);

  const manifestItemsByJobId = new Map(manifestByJob);

  if (error) {
    for (const job of jobs) {
      const proofRequired = isJobProofRequired(job);
      contexts.set(job.id, {
        proofRequired,
        proofState: deriveCustomerProofState({
          proofRequired,
          proofs: [],
          jobId: job.id,
          jobReference: job.job_reference,
          projectName: job.project_name,
        }),
        coverage: buildProofCoverageContext(proofRequired, [], []),
        boardLabel: proofRequired ? "Proof being prepared" : "Proof: Not required",
        manifestItems: manifestItemsByJobId.get(job.id) ?? [],
        proofs: [],
        proofLinks: [],
      });
    }

    return contexts;
  }

  const proofRows = mapProofRows(proofs ?? []);
  const proofIds = proofRows.map((proof) => proof.id);
  const links = await loadAllProofManifestLinks(adminClient, proofIds);

  const proofsByJobId = new Map<string, ProofRecordForItemCoverage[]>();
  for (const proof of proofRows) {
    const existing = proofsByJobId.get(proof.job_id) ?? [];
    existing.push(proof);
    proofsByJobId.set(proof.job_id, existing);
  }

  for (const job of jobs) {
    const jobProofs = proofsByJobId.get(job.id) ?? [];
    const jobProofIds = new Set(jobProofs.map((proof) => proof.id));
    const jobLinks = links.filter((link) => jobProofIds.has(link.proof_id));
    const manifestItems = manifestItemsByJobId.get(job.id) ?? [];

    contexts.set(
      job.id,
      await buildProofContextForJob(adminClient, job, manifestItems, jobProofs, jobLinks)
    );
  }

  return contexts;
}

export async function loadJobProofCoverageContext(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: jobRow } = await adminClient
    .from("jobs")
    .select("job_reference, project_name, proof_required, proof_requirements_confirmed_at")
    .eq("id", jobId)
    .maybeSingle();

  const jobReference = (jobRow?.job_reference as string) ?? "";
  const projectName = (jobRow?.project_name as string) ?? "";

  const { data: proofs } = await adminClient
    .from("job_proofs")
    .select(
      "id, job_id, proof_lineage_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
    )
    .eq("job_id", jobId)
    .order("version_number", { ascending: false });

  const proofRows = mapProofRows(proofs ?? []);
  const links = await loadAllProofManifestLinks(
    adminClient,
    proofRows.map((proof) => proof.id)
  );
  const { items: manifestItems } = await loadManifestItemsForProofContext(
    adminClient,
    jobId
  );

  const context = await buildProofContextForJob(
    adminClient,
    {
      id: jobId,
      job_reference: jobReference,
      project_name: projectName,
      proof_required: jobRow?.proof_required as boolean | null | undefined,
      proof_requirements_confirmed_at: jobRow?.proof_requirements_confirmed_at as
        | string
        | null
        | undefined,
    },
    manifestItems,
    proofRows,
    links
  );

  return {
    proofRequired: context.proofRequired,
    proofState: context.proofState,
    boardLabel: context.boardLabel,
    coverage: context.coverage,
    manifestItems: context.manifestItems,
    proofs: context.proofs,
    proofLinks: context.proofLinks,
  };
}

async function loadProfileDisplayName(
  adminClient: SupabaseClient,
  profileId: string | null | undefined
) {
  if (!profileId) {
    return null;
  }

  const { data } = await adminClient
    .from("profiles")
    .select("full_name, email")
    .eq("id", profileId)
    .maybeSingle();

  const fullName = data?.full_name?.trim();
  return fullName || data?.email || null;
}

export async function loadAdminJobProofingContext(jobId: string) {
  const adminClient = createAdminClient();

  try {
    const [requirement, proofsResult] = await Promise.all([
      loadJobProofRequirement(adminClient, jobId),
      loadProofsForJob(adminClient, jobId),
    ]);

    const bypassedByName = await loadProfileDisplayName(
      adminClient,
      requirement.bypassedByProfileId
    );

    return {
      schemaMissing: requirement.schemaMissing || proofsResult.schemaMissing,
      requirement: {
        proofRequired: requirement.proofRequired,
        workflowStatus: requirement.workflowStatus,
        bypassReason: requirement.bypassReason,
        bypassedAt: requirement.bypassedAt,
        bypassedByName,
      },
      proofs: proofsResult.proofs,
    };
  } catch {
    return {
      schemaMissing: true,
      requirement: {
        proofRequired: true,
        workflowStatus: "no_proof",
        bypassReason: null,
        bypassedAt: null,
        bypassedByName: null,
      },
      proofs: [],
    };
  }
}

export async function loadCustomerJobProofingContext(jobId: string) {
  const adminClient = createAdminClient();

  try {
    const [{ data: job }, requirement, proofsResult, coverageContext] = await Promise.all([
      adminClient
        .from("jobs")
        .select("id, job_reference, project_name, proof_requirements_confirmed_at")
        .eq("id", jobId)
        .maybeSingle(),
      loadJobProofRequirement(adminClient, jobId),
      loadProofsForJob(adminClient, jobId, { customerSafe: true }),
      loadJobProofCoverageContext(adminClient, jobId),
    ]);

    const customerProofs = proofsResult.proofs.filter(
      (proof) =>
        proof.status !== "draft" &&
        proof.status !== "internal_review" &&
        proof.status !== "ready_to_send" &&
        proof.status !== "cancelled"
    );

    const proofState = {
      ...coverageContext.proofState,
      label: coverageContext.proofState.label,
    };

    return {
      schemaMissing: requirement.schemaMissing || proofsResult.schemaMissing,
      proofRequired: coverageContext.proofRequired,
      workflowStatus: requirement.workflowStatus,
      proofs: customerProofs,
      proofState,
    };
  } catch {
    return {
      schemaMissing: true,
      proofRequired: true,
      workflowStatus: "no_proof",
      proofs: [],
      proofState: deriveCustomerProofState({
        proofRequired: true,
        proofs: [],
        jobId,
        jobReference: "",
        projectName: "",
      }),
    };
  }
}

export async function loadCustomerProofStatesByJobId(
  adminClient: SupabaseClient,
  jobs: Array<{
    id: string;
    job_reference: string;
    project_name: string;
    proof_required?: boolean | null;
    proof_requirements_confirmed_at?: string | null;
  }>
) {
  const states = new Map<string, CustomerProofState>();

  if (jobs.length === 0) {
    return states;
  }

  const contexts = await loadProductionBoardProofContextsByJobId(adminClient, jobs);

  for (const job of jobs) {
    const context = contexts.get(job.id);
    states.set(job.id, context?.proofState ?? deriveCustomerProofState({
      proofRequired: isJobProofRequired(job),
      proofs: [],
      jobId: job.id,
      jobReference: job.job_reference,
      projectName: job.project_name,
    }));
  }

  return states;
}

export async function loadCustomerPendingProofActions(companyId: string) {
  const adminClient = createAdminClient();

  const { data: jobs, error } = await adminClient
    .from("jobs")
    .select("id, job_reference, project_name, proof_required, proof_requirements_confirmed_at")
    .eq("company_id", companyId)
    .eq("customer_visible", true)
    .eq("proof_required", true);

  if (error || !jobs?.length) {
    return {
      awaitingApprovalCount: 0,
      actions: [] as CustomerProofActionItem[],
    };
  }

  const states = await loadCustomerProofStatesByJobId(adminClient, jobs);
  const actions = [...states.values()].flatMap(
    (state) => state.awaitingApprovalProofs
  );

  return {
    awaitingApprovalCount: actions.length,
    actions: actions.sort((left, right) => {
      const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : 0;
      const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : 0;
      return rightTime - leftTime;
    }),
  };
}
