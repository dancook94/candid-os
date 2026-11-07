/**
 * Quote numbers are allocated in application code via MAX(quote_number) + 1
 * ({@link components/quote-builder-form.tsx} `getNextQuoteNumber`).
 *
 * `repeat_quote` uses `allocate_next_quote_number()` in Postgres with an
 * advisory transaction lock instead. Until create-quote uses the same RPC,
 * two staff creating quotes at once can still collide on quote_number.
 */
export const QUOTE_NUMBER_ADVISORY_LOCK_KEY = 89_124_001;

export const QUOTE_NUMBER_COLLISION_REPORT = {
  repeatQuote: "Uses allocate_next_quote_number() inside repeat_quote (transaction-safe).",
  manualCreate:
    "New quotes from /admin/quotes/new still use client-side MAX(quote_number)+1 without a lock.",
  recommendedFollowUp:
    "Add allocate_next_quote_number() (or repeat_quote-style locking) to the standard create-quote save path in a follow-up change.",
} as const;
