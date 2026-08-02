#!/usr/bin/env node
/**
 * Complete open quote follow-up tasks for already-accepted quotes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reconcile-quote-follow-up-tasks.ts [quoteId]
 */

import { reconcileQuoteFollowUpTasks } from "../lib/crm/reconcile-quote-follow-up-tasks";
import { loadOpenQuoteFollowUpTasksForQuote } from "../lib/crm/complete-quote-follow-up-tasks";
import { createAdminClient } from "../lib/supabase/admin";

const quoteId =
  process.argv[2] ?? "12ebf8dc-417a-47aa-84f4-72e625d8fede";

async function main() {
  const adminClient = createAdminClient();

  const { data: quote, error: quoteError } = await adminClient
    .from("quotes")
    .select("id, quote_number, status, opportunity_id, company_id")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    console.error(quoteError?.message ?? "Quote not found.");
    process.exit(1);
  }

  const before = await loadOpenQuoteFollowUpTasksForQuote(adminClient, quoteId);

  console.log(
    JSON.stringify(
      {
        phase: "before",
        quote,
        openTasks: before.openTasks,
      },
      null,
      2
    )
  );

  const result = await reconcileQuoteFollowUpTasks({
    quoteId,
    trigger: "accepted_quote_reconciliation",
  });

  const after = await loadOpenQuoteFollowUpTasksForQuote(adminClient, quoteId);

  console.log(
    JSON.stringify(
      {
        phase: "after",
        result,
        openTasks: after.openTasks,
      },
      null,
      2
    )
  );

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
