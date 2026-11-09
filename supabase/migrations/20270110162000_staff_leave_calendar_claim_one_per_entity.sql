-- Claim at most one outbox row per leave_request_id or sickness_id per batch (Test only until approved).

BEGIN;

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
    WITH eligible AS (
      SELECT
        o.id,
        o.leave_request_id,
        o.sickness_id,
        o.created_at
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
    ),
    one_per_entity AS (
      SELECT e.id
      FROM (
        SELECT
          e.id,
          e.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(e.leave_request_id, e.sickness_id)
            ORDER BY e.created_at
          ) AS entity_row
        FROM eligible e
        WHERE COALESCE(e.leave_request_id, e.sickness_id) IS NOT NULL
      ) e
      WHERE e.entity_row = 1
      UNION ALL
      SELECT e.id
      FROM eligible e
      WHERE e.leave_request_id IS NULL
        AND e.sickness_id IS NULL
    ),
    candidates AS (
      SELECT ope.id
      FROM one_per_entity ope
      INNER JOIN public.staff_leave_calendar_sync_outbox o ON o.id = ope.id
      ORDER BY o.created_at
      LIMIT p_limit
      FOR UPDATE OF o SKIP LOCKED
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
  'Claims calendar outbox rows: at most one pending/failed row per leave or sickness entity per batch, chronological order, SKIP LOCKED.';

COMMIT;
