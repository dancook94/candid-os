#!/usr/bin/env node
/**
 * Complete open quote follow-up tasks for already-accepted quotes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reconcile-quote-follow-up-tasks.mjs [quoteId]
 */

import { createClient } from "@supabase/supabase-js";

const quoteId =
  process.argv[2] ?? "12ebf8dc-417a-47aa-84f4-72e625d8fede";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const adminClient = createClient(url, key, { auth: { persistSession: false } });
const OPEN_STATUSES = ["open", "in_progress"];

async function main() {
  const { data: quote, error: quoteError } = await adminClient
    .from("quotes")
    .select("id, quote_number, status, opportunity_id")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    console.error(quoteError?.message ?? "Quote not found.");
    process.exit(1);
  }

  if (quote.status !== "accepted") {
    console.log(JSON.stringify({ message: "Quote is not accepted.", quote }, null, 2));
    return;
  }

  const prefix = `Follow up Q-${quote.quote_number} — `;
  const { data: tasks, error: tasksError } = await adminClient
    .from("tasks")
    .select("id, title, status, completed_at")
    .eq("quote_id", quoteId)
    .in("status", OPEN_STATUSES);

  if (tasksError) {
    console.error(tasksError.message);
    process.exit(1);
  }

  const toComplete = (tasks ?? []).filter((task) => task.title.startsWith(prefix));
  const completedAt = new Date().toISOString();
  const completedTaskIds = [];

  for (const task of toComplete) {
    const { data: updated, error } = await adminClient
      .from("tasks")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", task.id)
      .in("status", OPEN_STATUSES)
      .select("id")
      .maybeSingle();

    if (!error && updated) {
      completedTaskIds.push(updated.id);
    }
  }

  const { data: finalTasks } = await adminClient
    .from("tasks")
    .select("id, title, status, completed_at")
    .eq("quote_id", quoteId);

  console.log(
    JSON.stringify(
      {
        quoteId,
        completedTaskIds,
        tasks: finalTasks,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
