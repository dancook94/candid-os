import { revalidateJobWorkflowRoutes } from "@/lib/quote-route-revalidation";

export function revalidateJobPages(input: {
  jobId: string;
  quoteId?: string | null;
  opportunityId?: string | null;
}) {
  revalidateJobWorkflowRoutes({
    jobId: input.jobId,
    quoteId: input.quoteId ?? null,
    opportunityId: input.opportunityId ?? null,
  });
}
