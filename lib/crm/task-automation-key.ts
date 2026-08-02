import type { SupabaseClient } from "@supabase/supabase-js";

export const QUOTE_FOLLOW_UP_AUTOMATION_KEY = "quote_follow_up";

export type QuoteFollowUpCompletionTrigger =
  | "quote_accepted"
  | "accepted_quote_reconciliation";

let automationKeyColumnAvailable: boolean | null = null;

export async function supportsTaskAutomationKey(
  adminClient: SupabaseClient
) {
  if (automationKeyColumnAvailable !== null) {
    return automationKeyColumnAvailable;
  }

  const { error } = await adminClient
    .from("tasks")
    .select("automation_key")
    .limit(0);

  automationKeyColumnAvailable =
    !error ||
    (!error.message?.includes("automation_key") &&
      error.code !== "42703" &&
      error.code !== "PGRST204");

  if (
    error &&
    (error.message?.includes("automation_key") ||
      error.code === "42703" ||
      error.code === "PGRST204")
  ) {
    automationKeyColumnAvailable = false;
  }

  return automationKeyColumnAvailable;
}

export function resetTaskAutomationKeyProbeForTests() {
  automationKeyColumnAvailable = null;
}
