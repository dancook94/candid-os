-- Staff leave calendar sync worker hardening (Stage 3B).
-- Reconciliation source kinds + atomic claim RPC. Test only until approved.

BEGIN;

ALTER TABLE public.staff_leave_calendar_sync_outbox
  DROP CONSTRAINT IF EXISTS staff_leave_calendar_sync_outbox_source_kind_check;

ALTER TABLE public.staff_leave_calendar_sync_outbox
  ADD CONSTRAINT staff_leave_calendar_sync_outbox_source_kind_check
  CHECK (
    source_kind IN (
      'leave_approved',
      'leave_cancelled_approved',
      'sickness_recorded',
      'reconcile_team_leave_upsert',
      'reconcile_team_leave_delete',
      'reconcile_sickness_upsert',
      'reconcile_google_refresh'
    )
  );

ALTER TABLE public.staff_leave_calendar_sync_outbox
  DROP CONSTRAINT IF EXISTS staff_leave_calendar_sync_outbox_source_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_calendar_sync_outbox_source_event_id_key
  ON public.staff_leave_calendar_sync_outbox (source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_calendar_sync_outbox_reconcile_leave_pending_idx
  ON public.staff_leave_calendar_sync_outbox (leave_request_id, operation, source_kind)
  WHERE leave_request_id IS NOT NULL
    AND source_kind LIKE 'reconcile_%'
    AND status IN ('pending', 'failed', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_calendar_sync_outbox_reconcile_sickness_pending_idx
  ON public.staff_leave_calendar_sync_outbox (sickness_id, operation, source_kind)
  WHERE sickness_id IS NOT NULL
    AND source_kind LIKE 'reconcile_%'
    AND status IN ('pending', 'failed', 'processing');

CREATE OR REPLACE FUNCTION public.staff_leave_calendar_claim_outbox_batch(
  p_limit integer DEFAULT 15,
  p_stale_before timestamptz DEFAULT (now() - interval '5 minutes')
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 50.';
  END IF;

  FOR claimed_id IN
    WITH candidates AS (
      SELECT o.id
      FROM public.staff_leave_calendar_sync_outbox o
      WHERE (
        o.status IN ('pending', 'failed')
        OR (
          o.status = 'processing'
          AND (
            o.locked_at IS NULL
            OR o.locked_at < p_stale_before
          )
        )
      )
      AND o.attempts < 5
      AND NOT EXISTS (
        SELECT 1
        FROM public.staff_leave_calendar_sync_outbox s2
        WHERE s2.id <> o.id
          AND s2.status = 'processing'
          AND s2.locked_at IS NOT NULL
          AND s2.locked_at >= p_stale_before
          AND (
            (o.leave_request_id IS NOT NULL AND s2.leave_request_id = o.leave_request_id)
            OR (o.sickness_id IS NOT NULL AND s2.sickness_id = o.sickness_id)
          )
      )
      ORDER BY
        COALESCE(o.leave_request_id, o.sickness_id),
        o.created_at
      FOR UPDATE OF o SKIP LOCKED
      LIMIT p_limit
    ),
    updated AS (
      UPDATE public.staff_leave_calendar_sync_outbox o
      SET
        status = 'processing',
        locked_at = now()
      FROM candidates c
      WHERE o.id = c.id
        AND (
          o.status IN ('pending', 'failed')
          OR (
            o.status = 'processing'
            AND (
              o.locked_at IS NULL
              OR o.locked_at < p_stale_before
            )
          )
        )
      RETURNING o.id
    )
    SELECT id FROM updated
  LOOP
    RETURN NEXT claimed_id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz) IS
  'Atomically claims calendar outbox rows with per-entity ordering and fresh sibling processing exclusion.';

REVOKE ALL ON FUNCTION public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz)
  TO service_role;

COMMIT;
