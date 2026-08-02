import { createAdminClient } from "@/lib/supabase/admin";
import { completeQuoteFollowUpTasksForAcceptedQuote } from "@/lib/crm/complete-quote-follow-up-tasks";
import { loadJobIdForQuote } from "@/lib/jobs/create-from-quote";

export async function reconcileQuoteFollowUpTasks({
  quoteId,
  actorProfileId,
}: {
  quoteId: string;
  actorProfileId?: string | null;
}) {
  const adminClient = createAdminClient();
  const jobId = await loadJobIdForQuote(adminClient, quoteId).catch(() => null);

  return completeQuoteFollowUpTasksForAcceptedQuote(adminClient, {
    quoteId,
    actorProfileId,
    jobId,
  });
}
