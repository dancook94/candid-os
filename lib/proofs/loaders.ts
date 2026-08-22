import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
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
import { loadJobProofRequirement, loadProofsForJob } from "@/lib/proofs/service";

export type ProductionBoardProofContext = {
  proofState: CustomerProofState;
  proofRequired: boolean;
  coverage: ProofCoverageContext;
};

async function loadProofManifestLinksByProofId(
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

export async function loadProductionBoardProofContextsByJobId(
  adminClient: SupabaseClient,
  jobs: Array<{
    id: string;
    job_reference: string;
    project_name: string;
    proof_required?: boolean | null;
  }>
) {
  const contexts = new Map<string, ProductionBoardProofContext>();

  if (jobs.length === 0) {
    return contexts;
  }

  const jobIds = jobs.map((job) => job.id);

  const { data: proofs, error } = await adminClient
    .from("job_proofs")
    .select(
      "id, job_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
    )
    .in("job_id", jobIds)
    .order("version_number", { ascending: false });

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
      });
    }

    return contexts;
  }

  const proofsByJobId = new Map<string, CustomerProofSummary[]>();
  const approvedProofIds: string[] = [];

  for (const proof of proofs ?? []) {
    const jobId = proof.job_id as string;
    const existing = proofsByJobId.get(jobId) ?? [];
    existing.push(proof as CustomerProofSummary);
    proofsByJobId.set(jobId, existing);

    if (proof.status === "approved") {
      approvedProofIds.push(proof.id as string);
    }
  }

  const links = await loadProofManifestLinksByProofId(adminClient, approvedProofIds);
  const linksByProofId = links;

  for (const job of jobs) {
    const proofRequired = isJobProofRequired(job);
    const jobProofs = proofsByJobId.get(job.id) ?? [];
    const jobApprovedProofIds = jobProofs
      .filter((proof) => proof.status === "approved")
      .map((proof) => proof.id);

    const proofState = deriveCustomerProofState({
      proofRequired,
      proofs: jobProofs,
      jobId: job.id,
      jobReference: job.job_reference,
      projectName: job.project_name,
    });

    contexts.set(job.id, {
      proofRequired,
      proofState,
      coverage: buildProofCoverageContext(
        proofRequired,
        jobApprovedProofIds,
        linksByProofId.filter((link) => jobApprovedProofIds.includes(link.proof_id))
      ),
    });
  }

  return contexts;
}

export async function loadJobProofCoverageContext(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: jobRow } = await adminClient
    .from("jobs")
    .select("job_reference, project_name, proof_required")
    .eq("id", jobId)
    .maybeSingle();

  const proofRequired = isJobProofRequired(jobRow ?? {});
  const jobReference = (jobRow?.job_reference as string) ?? "";
  const projectName = (jobRow?.project_name as string) ?? "";

  const { data: proofs } = await adminClient
    .from("job_proofs")
    .select(
      "id, job_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
    )
    .eq("job_id", jobId)
    .order("version_number", { ascending: false });

  const jobProofs = (proofs ?? []) as CustomerProofSummary[];
  const approvedProofIds = jobProofs
    .filter((proof) => proof.status === "approved")
    .map((proof) => proof.id);

  const links = await loadProofManifestLinksByProofId(adminClient, approvedProofIds);

  return {
    proofRequired,
    proofState: deriveCustomerProofState({
      proofRequired,
      proofs: jobProofs,
      jobId,
      jobReference,
      projectName,
    }),
    coverage: buildProofCoverageContext(proofRequired, approvedProofIds, links),
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
    const [{ data: job }, requirement, proofsResult] = await Promise.all([
      adminClient
        .from("jobs")
        .select("id, job_reference, project_name")
        .eq("id", jobId)
        .maybeSingle(),
      loadJobProofRequirement(adminClient, jobId),
      loadProofsForJob(adminClient, jobId, { customerSafe: true }),
    ]);

    const customerProofs = proofsResult.proofs.filter(
      (proof) =>
        proof.status !== "draft" &&
        proof.status !== "internal_review" &&
        proof.status !== "ready_to_send" &&
        proof.status !== "cancelled"
    );

    const proofState = deriveCustomerProofState({
      proofRequired: requirement.proofRequired,
      proofs: customerProofs,
      jobId,
      jobReference: (job?.job_reference as string) ?? "",
      projectName: (job?.project_name as string) ?? "",
    });

    return {
      schemaMissing: requirement.schemaMissing || proofsResult.schemaMissing,
      proofRequired: requirement.proofRequired,
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
  }>
) {
  const states = new Map<string, CustomerProofState>();

  if (jobs.length === 0) {
    return states;
  }

  const jobIds = jobs.map((job) => job.id);

  const { data: proofs, error } = await adminClient
    .from("job_proofs")
    .select(
      "id, job_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
    )
    .in("job_id", jobIds)
    .order("version_number", { ascending: false });

  if (error) {
    return states;
  }

  const customerVisibleProofs = (proofs ?? []).filter(
    (proof) =>
      !["draft", "internal_review", "ready_to_send", "cancelled"].includes(
        proof.status as string
      )
  );
  const proofsByJobId = new Map<string, typeof customerVisibleProofs>();
  for (const proof of customerVisibleProofs) {
    const existing = proofsByJobId.get(proof.job_id as string) ?? [];
    existing.push(proof);
    proofsByJobId.set(proof.job_id as string, existing);
  }

  for (const job of jobs) {
    const jobProofs = (proofsByJobId.get(job.id) ?? []) as CustomerProofSummary[];

    states.set(
      job.id,
      deriveCustomerProofState({
        proofRequired: isJobProofRequired(job),
        proofs: jobProofs,
        jobId: job.id,
        jobReference: job.job_reference,
        projectName: job.project_name,
      })
    );
  }

  return states;
}

export async function loadCustomerPendingProofActions(companyId: string) {
  const adminClient = createAdminClient();

  const { data: jobs, error } = await adminClient
    .from("jobs")
    .select("id, job_reference, project_name, proof_required")
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
