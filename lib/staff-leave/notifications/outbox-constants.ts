/** Maximum delivery attempts per outbox row before giving up. */
export const STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS = 5;

/** Locks older than this may be reclaimed by another worker (still idempotent at send). */
export const STAFF_LEAVE_OUTBOX_STALE_LOCK_MS = 5 * 60 * 1000;

export const STAFF_LEAVE_OUTBOX_DEFAULT_BATCH_LIMIT = 15;
