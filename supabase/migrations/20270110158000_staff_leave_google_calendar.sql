-- Staff leave Google Calendar sync (Stage 3A). Outbox + mappings + enqueue triggers.
-- Apply on candid-os-test (axhkdwgmwhlbsstumndh) only; do not apply on Live without approval.

BEGIN;

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_leave_calendar_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_channel text NOT NULL,
  operation text NOT NULL,
  source_kind text NOT NULL,
  source_event_id uuid REFERENCES public.staff_leave_request_events (id) ON DELETE CASCADE,
  leave_request_id uuid REFERENCES public.staff_leave_requests (id) ON DELETE CASCADE,
  sickness_id uuid REFERENCES public.staff_absence_sickness (id) ON DELETE CASCADE,
  employee_profile_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  sync_provider text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  discarded_at timestamptz,
  discard_reason text,
  CONSTRAINT staff_leave_calendar_sync_outbox_source_event_id_key UNIQUE (source_event_id),
  CONSTRAINT staff_leave_calendar_sync_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'discarded')),
  CONSTRAINT staff_leave_calendar_sync_outbox_sync_provider_check
    CHECK (sync_provider IS NULL OR sync_provider IN ('mock', 'google')),
  CONSTRAINT staff_leave_calendar_sync_outbox_channel_check
    CHECK (calendar_channel IN ('team_leave', 'sickness_management')),
  CONSTRAINT staff_leave_calendar_sync_outbox_operation_check
    CHECK (operation IN ('upsert', 'delete')),
  CONSTRAINT staff_leave_calendar_sync_outbox_source_kind_check
    CHECK (
      source_kind IN (
        'leave_approved',
        'leave_cancelled_approved',
        'sickness_recorded'
      )
    ),
  CONSTRAINT staff_leave_calendar_sync_outbox_sent_requires_provider
    CHECK (status <> 'sent' OR sync_provider IS NOT NULL),
  CONSTRAINT staff_leave_calendar_sync_outbox_leave_or_sickness
    CHECK (
      (leave_request_id IS NOT NULL AND sickness_id IS NULL)
      OR (leave_request_id IS NULL AND sickness_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_calendar_sync_outbox_sickness_upsert_idx
  ON public.staff_leave_calendar_sync_outbox (sickness_id)
  WHERE source_kind = 'sickness_recorded' AND sickness_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS staff_leave_calendar_sync_outbox_pending_idx
  ON public.staff_leave_calendar_sync_outbox (status, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS staff_leave_calendar_sync_outbox_leave_request_idx
  ON public.staff_leave_calendar_sync_outbox (leave_request_id, created_at)
  WHERE leave_request_id IS NOT NULL;

COMMENT ON TABLE public.staff_leave_calendar_sync_outbox IS
  'Durable queue for staff leave / sickness Google Calendar sync; processors must validate live source state before upsert/delete.';

COMMENT ON COLUMN public.staff_leave_calendar_sync_outbox.sync_provider IS
  'mock = simulated delivery; google = real Calendar API (only when explicitly enabled server-side).';

-- ---------------------------------------------------------------------------
-- Event mappings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_leave_calendar_event_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_channel text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  google_calendar_id text NOT NULL,
  google_event_id text NOT NULL,
  sync_provider text NOT NULL,
  content_fingerprint text NOT NULL,
  google_etag text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_leave_calendar_event_mappings_channel_check
    CHECK (calendar_channel IN ('team_leave', 'sickness_management')),
  CONSTRAINT staff_leave_calendar_event_mappings_entity_type_check
    CHECK (entity_type IN ('leave_request', 'sickness')),
  CONSTRAINT staff_leave_calendar_event_mappings_provider_check
    CHECK (sync_provider IN ('mock', 'google')),
  CONSTRAINT staff_leave_calendar_event_mappings_entity_key
    UNIQUE (calendar_channel, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS staff_leave_calendar_event_mappings_active_idx
  ON public.staff_leave_calendar_event_mappings (calendar_channel, entity_type)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.staff_leave_calendar_event_mappings IS
  'Maps Candid OS leave/sickness records to Calendar event IDs; authoritative for idempotent upsert/delete.';

-- ---------------------------------------------------------------------------
-- Enqueue from leave audit events (parallel to email notifications; no shared trigger)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_calendar_enqueue_from_request_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.staff_leave_requests%ROWTYPE;
  prev_status text;
BEGIN
  SELECT * INTO req
  FROM public.staff_leave_requests r
  WHERE r.id = NEW.request_id;

  IF req.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF req.leave_kind NOT IN ('annual', 'additional_paid') THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'approved' AND req.status = 'approved' THEN
    INSERT INTO public.staff_leave_calendar_sync_outbox (
      calendar_channel,
      operation,
      source_kind,
      source_event_id,
      leave_request_id,
      employee_profile_id
    )
    VALUES (
      'team_leave',
      'upsert',
      'leave_approved',
      NEW.id,
      req.id,
      req.profile_id
    )
    ON CONFLICT (source_event_id) DO NOTHING;
  ELSIF NEW.event_type = 'cancelled' THEN
    prev_status := COALESCE(NEW.payload->>'previous_status', '');

    IF prev_status = 'approved' AND req.status = 'cancelled' THEN
      INSERT INTO public.staff_leave_calendar_sync_outbox (
        calendar_channel,
        operation,
        source_kind,
        source_event_id,
        leave_request_id,
        employee_profile_id
      )
      VALUES (
        'team_leave',
        'delete',
        'leave_cancelled_approved',
        NEW.id,
        req.id,
        req.profile_id
      )
      ON CONFLICT (source_event_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_calendar_enqueue_request_trigger
  ON public.staff_leave_request_events;

CREATE TRIGGER staff_leave_calendar_enqueue_request_trigger
  AFTER INSERT ON public.staff_leave_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_calendar_enqueue_from_request_event();

-- ---------------------------------------------------------------------------
-- Enqueue sickness (management calendar only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_calendar_enqueue_from_sickness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.staff_leave_calendar_sync_outbox (
    calendar_channel,
    operation,
    source_kind,
    sickness_id,
    employee_profile_id
  )
  VALUES (
    'sickness_management',
    'upsert',
    'sickness_recorded',
    NEW.id,
    NEW.profile_id
  )
  ON CONFLICT (sickness_id) WHERE source_kind = 'sickness_recorded' DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_calendar_enqueue_sickness_trigger
  ON public.staff_absence_sickness;

CREATE TRIGGER staff_leave_calendar_enqueue_sickness_trigger
  AFTER INSERT ON public.staff_absence_sickness
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_calendar_enqueue_from_sickness();

-- ---------------------------------------------------------------------------
-- Discard guard (unsent rows only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_calendar_sync_outbox_discard_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'discarded' AND OLD.status = 'sent' THEN
    RAISE EXCEPTION 'Cannot discard sent staff leave calendar sync outbox rows.';
  END IF;

  IF NEW.status = 'discarded' AND OLD.status NOT IN ('pending', 'failed', 'processing') THEN
    RAISE EXCEPTION 'Only unsent staff leave calendar sync outbox rows can be discarded.';
  END IF;

  IF NEW.status = 'discarded' AND OLD.sync_provider IS NOT NULL AND OLD.sync_provider = 'google' THEN
    RAISE EXCEPTION 'Cannot discard rows that were delivered via Google Calendar API.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_calendar_sync_outbox_discard_guard_trigger
  ON public.staff_leave_calendar_sync_outbox;

CREATE TRIGGER staff_leave_calendar_sync_outbox_discard_guard_trigger
  BEFORE UPDATE ON public.staff_leave_calendar_sync_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_calendar_sync_outbox_discard_guard();

-- ---------------------------------------------------------------------------
-- RLS + grants (processor uses service_role only)
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_leave_calendar_sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_calendar_event_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.staff_leave_calendar_sync_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.staff_leave_calendar_event_mappings FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_leave_calendar_sync_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_leave_calendar_event_mappings TO service_role;

GRANT SELECT ON TABLE public.staff_absence_sickness TO service_role;
GRANT SELECT ON TABLE public.profiles TO service_role;

COMMIT;
