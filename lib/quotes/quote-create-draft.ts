export const QUOTE_CREATE_DRAFT_MIGRATION_FILE =
  "supabase/migrations/20261109160000_create_admin_quote_draft.sql";

export const QUOTE_CREATE_DRAFT_RPC = "create_admin_quote_draft";

/** Matches docs test-release §4 smoke `to_regprocedure` string and GRANT signatures. */
export const QUOTE_CREATE_DRAFT_RPC_REGPROCEDURE =
  "public.create_admin_quote_draft(uuid, uuid, uuid, uuid, text, date, uuid, date, integer, text, text, text, numeric, numeric, numeric, numeric)";

export type QuoteCreateDraftMigrationContract = {
  hasCreateRpc: boolean;
  usesAllocateNextQuoteNumber: boolean;
  enforcesAdminCheck: boolean;
  requiresIdempotencyKey: boolean;
  hasIdempotencyTable: boolean;
  hasIdempotencyGrants: boolean;
  isSecurityInvoker: boolean;
  singleTransactionInsertsQuoteAndVersion: boolean;
};

export function readQuoteCreateDraftMigrationContract(
  source: string
): QuoteCreateDraftMigrationContract {
  const fnMatch = /CREATE OR REPLACE FUNCTION public\.create_admin_quote_draft\([\s\S]*?\$\$;/m.exec(
    source
  )?.[0];

  return {
    hasCreateRpc: source.includes(
      "CREATE OR REPLACE FUNCTION public.create_admin_quote_draft"
    ),
    usesAllocateNextQuoteNumber: /v_next_number := public\.allocate_next_quote_number\(\)/m.test(
      source
    ),
    enforcesAdminCheck: /IF NOT public\.is_approved_candid_admin\(\)/m.test(source),
    requiresIdempotencyKey: /Idempotency key is required/m.test(source),
    hasIdempotencyTable: source.includes(
      "CREATE TABLE IF NOT EXISTS public.quote_create_requests"
    ),
    hasIdempotencyGrants:
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.quote_create_requests TO authenticated/.test(
        source
      ),
    isSecurityInvoker: fnMatch ? !fnMatch.includes("SECURITY DEFINER") : false,
    singleTransactionInsertsQuoteAndVersion:
      fnMatch != null &&
      /INSERT INTO public\.quotes/.test(fnMatch) &&
      /INSERT INTO public\.quote_versions/.test(fnMatch) &&
      /allocate_next_quote_number/.test(fnMatch),
  };
}
