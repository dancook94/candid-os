/**
 * Quote numbers are allocated in Postgres via `allocate_next_quote_number()`
 * (`pg_advisory_xact_lock` on {@link QUOTE_NUMBER_ADVISORY_LOCK_KEY}).
 * Standard create uses `create_admin_quote_draft`; repeat uses `repeat_quote`.
 */
export const QUOTE_NUMBER_ADVISORY_LOCK_KEY = 89_124_001;

export const QUOTE_NUMBER_COLLISION_REPORT = {
  repeatQuote: "Uses allocate_next_quote_number() inside repeat_quote (transaction-safe).",
  manualCreate:
    "New quotes from /admin/quotes/new use create_admin_quote_draft with the same allocator.",
  recommendedFollowUp:
    "Job references still use client-side MAX scanning in allocateNextJobNumber (separate follow-up).",
} as const;
