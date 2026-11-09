# Staff leave calendar sync — controlled processing (Test only)

**Environment:** `NEXT_PUBLIC_APP_ENV=test` on [candid-os-test.vercel.app](https://candid-os-test.vercel.app)  
**Do not use on Live.**

## Scheduled cron

`GET /api/cron/staff-leave-calendar-sync` — Vercel schedule `*/5`, `CRON_SECRET`, processes up to **25** claimable outbox rows with database-level batch claim when migration `20270110159000` is applied.

Requires `STAFF_LEAVE_GCAL_ENABLED=true` and `STAFF_LEAVE_GCAL_PROVIDER=mock` for mock delivery on Test.

When `STAFF_LEAVE_GCAL_ENABLED=false`, the worker **does not claim or mutate** outbox rows (no-op).

### Pausing scheduled drain (Test only)

Set `STAFF_LEAVE_GCAL_CRON_PAUSED=true` on **candid-os-test** during controlled E2E so the five-minute Vercel cron does not compete with scoped runs. Staff leave **notification** cron is unaffected.

## Controlled cron (single outbox)

`GET /api/cron/staff-leave-calendar-sync/controlled?outboxId=<uuid>`

Same auth options as staff leave notifications controlled cron (`CRON_SECRET` or Test-only `e2eAuth=1` bearer derived from service role key).

## Mock vs Google

- Successful mock runs set `sync_provider = mock` on outbox and mappings.
- Google provider remains disabled in application code until explicitly implemented and approved.
- Reconciliation can flag `mock_needs_google_sync` for future approved resync when Google is enabled (no historical backfill).

## Concurrency

Scheduled calendar cron and staff leave **notification** cron are independent. Drain or reconcile obsolete calendar outbox before controlled tests when isolation matters.
