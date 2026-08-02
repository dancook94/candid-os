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
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[tasks] quote follow-up auto-complete failed", {
        quoteId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return { completedTaskIds: [], alreadyCompletedCount: 0 };
  }
}
