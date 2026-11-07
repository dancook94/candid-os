export const REPEAT_QUOTE_MIGRATION_FILE =
  "supabase/migrations/20261109140000_quote_repeat.sql";

export const REPEAT_QUOTE_RPC = "repeat_quote";

export type RepeatMaterialPricingMode = "refresh_catalogue" | "keep_saved";

export type RepeatQuoteRpcParams = {
  p_source_version_id: string;
  p_refresh_material_rates: boolean;
  p_idempotency_key: string;
  p_expiry_date: string;
};

export function repeatQuoteRefreshFlag(mode: RepeatMaterialPricingMode): boolean {
  return mode === "refresh_catalogue";
}

export type RepeatQuoteMigrationContract = {
  hasRepeatRpc: boolean;
  hasAllocator: boolean;
  hasIdempotencyTable: boolean;
  hasLineageColumns: boolean;
  doesNotUpdateSourceQuote: boolean;
  includesDuplicateVersionRepair: boolean;
  grantsAuthenticatedOnly: boolean;
};

export function readRepeatQuoteMigrationContract(source: string): RepeatQuoteMigrationContract {
  return {
    hasRepeatRpc: source.includes("CREATE OR REPLACE FUNCTION public.repeat_quote"),
    hasAllocator: source.includes("CREATE OR REPLACE FUNCTION public.allocate_next_quote_number"),
    hasIdempotencyTable: source.includes("CREATE TABLE IF NOT EXISTS public.quote_repeat_requests"),
    hasLineageColumns:
      source.includes("repeated_from_quote_id") &&
      source.includes("repeated_from_quote_version_id"),
    doesNotUpdateSourceQuote:
      !/UPDATE\s+public\.quotes\s+[\s\S]*?WHERE\s+id\s*=\s*v_source\.quote_id/i.test(source) &&
      !/UPDATE\s+public\.quotes\s+[\s\S]*?WHERE\s+id\s*=\s*p_source_quote_id/i.test(source),
    includesDuplicateVersionRepair: source.includes(
      "CREATE OR REPLACE FUNCTION public.duplicate_quote_version"
    ),
    grantsAuthenticatedOnly:
      source.includes("GRANT EXECUTE ON FUNCTION public.repeat_quote") &&
      source.includes("TO authenticated"),
  };
}
