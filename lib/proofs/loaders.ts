import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  deriveCustomerProofState,
  type CustomerProofActionItem,
  type CustomerProofState,
  type CustomerProofSummary,
} from "@/lib/proofs/customer-state";
import { loadJobProofRequirement, loadProofsForJob } from "@/lib/proofs/service";

export async function loadAdminJobProofingContext(jobId: string) {
  const adminClient = createAdminClient();

  try {
    const [requirement, proofsResult] = await Promise.all([
      loadJobProofRequirement(adminClient, jobId),
      loadProofsForJob(adminClient, jobId),
    ]);

    return {
      schemaMissing: requirement.schemaMissing || proofsResult.schemaMissing,
      requirement: {
        proofRequired: requirement.proofRequired,
        workflowStatus: requirement.workflowStatus,
        bypassReason: requirement.bypassReason,
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
        proofRequired: Boolean(job.proof_required ?? true),
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
