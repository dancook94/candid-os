import { revalidatePath } from "next/cache";

import { revalidateJobWorkflowRoutes } from "@/lib/quote-route-revalidation";

export function revalidateJobPages(input: {
  jobId: string;
  quoteId?: string | null;
  opportunityId?: string | null;
}) {
  revalidatePath("/dashboard");
  revalidatePath("/admin");

  revalidateJobWorkflowRoutes({
    jobId: input.jobId,
    quoteId: input.quoteId ?? null,
    opportunityId: input.opportunityId ?? null,
  });
}
