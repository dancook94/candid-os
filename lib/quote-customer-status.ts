import type { SupabaseClient } from "@supabase/supabase-js";

type QuoteStatusRow = {
  id: string;
  status: string;
};

export async function resolveCustomerQuoteStatuses(
  supabase: SupabaseClient,
  quotes: QuoteStatusRow[]
): Promise<Map<string, string>> {
  const statusByQuoteId = new Map<string, string>();

  for (const quote of quotes) {
    statusByQuoteId.set(quote.id, quote.status);
  }

  const draftQuoteIds = quotes
    .filter((quote) => quote.status === "draft")
    .map((quote) => quote.id);

  if (draftQuoteIds.length === 0) {
    return statusByQuoteId;
  }

  const { data: visibleVersions } = await supabase
    .from("quote_versions")
    .select("quote_id, version_status, version_number")
    .in("quote_id", draftQuoteIds)
    .neq("version_status", "draft")
    .order("version_number", { ascending: false });

  for (const version of visibleVersions ?? []) {
    if (statusByQuoteId.get(version.quote_id) === "draft") {
      statusByQuoteId.set(version.quote_id, version.version_status);
    }
  }

  return statusByQuoteId;
}

export async function resolveCustomerQuoteStatus(
  supabase: SupabaseClient,
  quote: QuoteStatusRow
): Promise<string> {
  const statuses = await resolveCustomerQuoteStatuses(supabase, [quote]);
  return statuses.get(quote.id) ?? quote.status;
}
