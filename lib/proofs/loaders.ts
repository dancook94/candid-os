import { createAdminClient } from "@/lib/supabase/admin";
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
    const [requirement, proofsResult] = await Promise.all([
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

    return {
      schemaMissing: requirement.schemaMissing || proofsResult.schemaMissing,
      proofRequired: requirement.proofRequired,
      workflowStatus: requirement.workflowStatus,
      proofs: customerProofs,
    };
  } catch {
    return {
      schemaMissing: true,
      proofRequired: true,
      workflowStatus: "no_proof",
      proofs: [],
    };
  }
}
