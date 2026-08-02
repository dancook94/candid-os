import { revalidatePath } from "next/cache";

export function revalidateJobWorkflowRoutes(input: {
  jobId?: string | null;
  quoteId?: string | null;
  quoteRequestId?: string | null;
  opportunityId?: string | null;
}) {
  revalidatePath("/jobs");
  revalidatePath("/admin/jobs");

  if (input.jobId) {
    revalidatePath(`/jobs/${input.jobId}`);
    revalidatePath(`/admin/jobs/${input.jobId}`);
  }

  if (input.quoteId) {
    revalidatePath(`/quotes/${input.quoteId}`);
    revalidatePath(`/admin/quotes/${input.quoteId}`);
  }

  if (input.quoteRequestId) {
    revalidatePath(`/admin/quote-requests/${input.quoteRequestId}`);
  }

  if (input.opportunityId) {
    revalidatePath(`/admin/opportunities/${input.opportunityId}`);
  }
}

export function revalidateQuoteWorkflowRoutes(input: {
  quoteId?: string | null;
  quoteRequestId?: string | null;
  jobId?: string | null;
  opportunityId?: string | null;
}) {
  revalidatePath("/admin");
  revalidatePath("/admin/quotes");
  revalidatePath("/admin/quote-requests");
  revalidatePath("/admin/opportunities");
  revalidatePath("/dashboard");
  revalidatePath("/quotes");
  revalidatePath("/jobs");

  if (input.quoteId) {
    revalidatePath(`/admin/quotes/${input.quoteId}`);
    revalidatePath(`/quotes/${input.quoteId}`);
  }

  if (input.quoteRequestId) {
    revalidatePath(`/admin/quote-requests/${input.quoteRequestId}`);
    revalidatePath(`/quotes/${input.quoteRequestId}`);
  }

  revalidateJobWorkflowRoutes(input);
}
