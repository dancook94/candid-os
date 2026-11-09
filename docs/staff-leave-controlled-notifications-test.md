# Staff leave notifications — controlled delivery (Test only)

**Environment:** `NEXT_PUBLIC_APP_ENV=test` on [candid-os-test.vercel.app](https://candid-os-test.vercel.app)  
**Do not use on Live.**

## Scheduled cron (unchanged)

`GET /api/cron/staff-leave-notifications` — Vercel schedule `*/5`, `CRON_SECRET`, processes up to **25** claimable outbox rows in `created_at` order. This is the production-shaped backlog drain on Test.

## Controlled cron (single outbox)

`GET /api/cron/staff-leave-notifications/controlled?outboxId=<uuid>`

Requirements (all must pass):

1. `isTestAppEnvironment()` — returns 404 on non-Test deploys.
2. `CRON_SECRET` configured and `Authorization: Bearer <secret>` matches.
3. **`outboxId` required** — processes **at most one** row with that primary key. No `requestId` scope and **no fallback** to unscoped batch processing.

Response includes `scoped: true` and `scope: { outboxId }` plus processor counters for that row only.

### Concurrency warning

The scheduled cron and the controlled endpoint are **independent**. During a controlled test, the `*/5` job may still deliver **other** pending/failed outbox rows. A controlled response only describes the targeted `outboxId`; it does **not** guarantee no other emails in the same minute. For isolation:

- Drain or **discard** obsolete backlog before controlled runs (`scripts/staff-leave-notification-backlog.mjs`), or
- Run controlled tests when the queue is empty, and interpret cron + Resend logs if overlap is suspected.

## Backlog discard (unsent only)

Migration: `20270110157000_staff_leave_notification_outbox_discard.sql`

- Adds outbox status `discarded` with `discarded_at` / `discard_reason`.
- DB trigger blocks discarding **sent** rows or any row not in `pending` / `failed` / `processing`.
- **Never** deletes `notifications` audit rows.

CLI (Test Supabase ref `axhkdwgmwhlbsstumndh` only):

```bash
node scripts/staff-leave-notification-backlog.mjs list
node scripts/staff-leave-notification-backlog.mjs discard --outbox-id <uuid> --reason "..." --dry-run
```

## Stage 2 retry script

`scripts/retry-stage2-controlled-notification.mjs` calls the **controlled** cron URL (or local processor with `outboxId`), not the scheduled backlog cron.

## Stage 2 all-scenarios E2E (single run)

After migration `20270110157000` and deploy:

```bash
# Apply migration (direct Postgres, Test ref only)
DATABASE_URL='postgresql://...' npx tsx scripts/apply-staff-leave-outbox-discard-migration.mts

CRON_SECRET='…' npm run verify:stage2-leave-notifications-e2e
```

When `CRON_SECRET` is not available locally, the E2E script may use **Test-only** `e2eAuth=1` with a bearer derived from `SUPABASE_SERVICE_ROLE_KEY` (same key as on candid-os-test; never sent on the wire as the raw key). Production schedulers still require `CRON_SECRET`.

Runs six scenarios via RPC (no API flush), delivers each outbox through the controlled cron, and prints a PASS/FAIL table. Requires an empty claimable outbox queue when possible; scheduled cron may still deliver unrelated mail concurrently.
