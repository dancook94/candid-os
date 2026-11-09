# Test Supabase migrations — Purchasing & Quoting

**Project ref (Test only):** `axhkdwgmwhlbsstumndh`  
**Do not run on Live (`wdpfqkqnoyeshocwzrxh`).**

Apply in order via **Supabase Dashboard → SQL Editor** (or `psql` with a session you can roll back if validating).

## Pre-checks

1. Confirm `confirm_existing_bulk_invoice_links` already exists if you applied `20261102153000` earlier (optional re-apply is safe — `CREATE OR REPLACE`).
2. Take a note of current `purchase_order_revisions_guard` if you need to diff after apply.

## 1. Purchasing email (`20261108120000_purchasing_orders_email.sql`)

Paste the full file:

`supabase/migrations/20261108120000_purchasing_orders_email.sql`

**Post-apply smoke (same session, optional rollback):**

```sql
BEGIN;
SELECT to_regprocedure('public.set_issued_purchase_order_orders_email(uuid,text)') IS NOT NULL AS has_set_email;
ROLLBACK;
```

## 2. Quote wastage (`20261108130000_quote_wastage.sql`)

Paste the full file:

`supabase/migrations/20261108130000_quote_wastage.sql`

**Post-apply smoke:**

```sql
BEGIN;
SELECT public.quote_normalize_wastage_rate(0.125) AS normalized;
SELECT public.quote_costed_area_sqm(10::numeric, 0.15::numeric) AS costed;
ROLLBACK;
```

Expect `normalized = 0.1250` and `costed = 11.500000`.

## 3. Quote one-off costs (`20261108150000_quote_one_off_costs.sql`)

**Compatibility:** Existing quotes are unchanged (no backfill). Production cost rows keep working; the migration only adds optional columns, extends the `component_type` check with `one_off`, and updates `save_composite_quote_line_cost` to persist supplier reference and notes.

Paste the full file:

`supabase/migrations/20261108150000_quote_one_off_costs.sql`

**Post-apply smoke:**

```sql
BEGIN;
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.quote_item_cost_components'::regclass
  AND conname = 'quote_item_cost_components_type_check';
ROLLBACK;
```

Expect `one_off` in the allowed type list.

## 4. Quote create draft (`20261109160000_create_admin_quote_draft.sql`)

Adds `create_admin_quote_draft`, idempotency table `quote_create_requests`, and grants.
Requires `allocate_next_quote_number()` from `20261109140000_quote_repeat.sql` (apply that first).

Paste the full file:

`supabase/migrations/20261109160000_create_admin_quote_draft.sql`

**Post-apply smoke:**

```sql
BEGIN;
SELECT to_regprocedure(
  'public.create_admin_quote_draft(uuid, uuid, uuid, uuid, text, date, uuid, date, integer, text, text, text, numeric, numeric, numeric, numeric)'
) IS NOT NULL AS has_create_draft;
ROLLBACK;
```

## 5. Repeat quote (`20261109140000_quote_repeat.sql`)

Adds `repeat_quote`, quote lineage columns, idempotency table, and
`allocate_next_quote_number()`.

**Pre-check:** `duplicate_quote_version` already exists on Test (RPC probe
returns admin permission error, not “function missing”). This migration does
**not** replace `duplicate_quote_version`.

Paste the full file:

`supabase/migrations/20261109140000_quote_repeat.sql`

**Post-apply smoke:**

```sql
BEGIN;
SELECT to_regprocedure('public.repeat_quote(uuid, boolean, uuid, date)') IS NOT NULL AS has_repeat;
SELECT to_regprocedure('public.allocate_next_quote_number()') IS NOT NULL AS has_allocate;
ROLLBACK;
```

## 6. Staff leave outbox discard (`20270110157000_staff_leave_notification_outbox_discard.sql`)

**Test only.** Apply after `20270110156000_staff_leave_notification_service_role_grants.sql`.

Paste the full file:

`supabase/migrations/20270110157000_staff_leave_notification_outbox_discard.sql`

**Post-apply smoke:**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'staff_leave_notification_outbox'
  AND column_name IN ('discarded_at', 'discard_reason');

SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'staff_leave_notification_outbox_status_check';
```

Expect `discarded` in the status check. Controlled notification behaviour: `docs/staff-leave-controlled-notifications-test.md`.

## 7. Invoice confirm validation (already on Test)

Run rollback-only script (no commit):

`scripts/validate-confirm-existing-invoice-links-test.sql`

## Rollback notes

- **PO email:** Re-apply `purchase_order_revisions_guard` from `supabase/migrations/20261024120000_purchase_orders.sql` (lines 780–842) and `DROP FUNCTION set_issued_purchase_order_orders_email`.
- **Wastage:** Re-apply prior `save_composite_quote_line_cost` from your last known-good dump; restore `quote_item_material_components_wastage_fixed` and previous `area_shape` constraint from `docs/proposed-quote-item-material-components-migration.sql` (lines 256–283).

After migrations, reload PostgREST schema (Supabase often does this automatically within a minute).
