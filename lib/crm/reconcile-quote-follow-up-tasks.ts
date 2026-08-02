import { createAdminClient } from "@/lib/supabase/admin";
import { completeQuoteFollowUpTasksForAcceptedQuote } from "@/lib/crm/complete-quote-follow-up-tasks";
import { loadJobIdForQuote } from "@/lib/jobs/create-from-quote";
import type { QuoteFollowUpCompletionTrigger } from "@/lib/crm/task-automation-key";

export async function reconcileQuoteFollowUpTasks({
  quoteId,
  actorProfileId,
  trigger = "accepted_quote_reconciliation",
}: {
  quoteId: string;
  actorProfileId?: string | null;
  trigger?: QuoteFollowUpCompletionTrigger;
}) {
  const adminClient = createAdminClient();
  const jobId = await loadJobIdForQuote(adminClient, quoteId).catch(() => null);

  return completeQuoteFollowUpTasksForAcceptedQuote(adminClient, {
    quoteId,
    actorProfileId,
    jobId,
    trigger,
  });
}
