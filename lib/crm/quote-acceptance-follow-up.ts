import { completeQuoteFollowUpTasksForAcceptedQuote } from "@/lib/crm/complete-quote-follow-up-tasks";
import { createAdminClient } from "@/lib/supabase/admin";

export async function completeQuoteFollowUpTasksAfterAcceptance({
  quoteId,
  actorProfileId,
  jobId = null,
}: {
  quoteId: string;
  actorProfileId?: string | null;
  jobId?: string | null;
}) {
  try {
    const adminClient = createAdminClient();

    return await completeQuoteFollowUpTasksForAcceptedQuote(adminClient, {
      quoteId,
      actorProfileId,
      jobId,
      trigger: "quote_accepted",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[tasks] quote follow-up auto-complete failed", {
      quoteId,
      message,
    });

    return {
      completedTaskIds: [],
      alreadyCompletedCount: 0,
      matchedTaskIds: [],
      errors: [message],
    };
  }
}
