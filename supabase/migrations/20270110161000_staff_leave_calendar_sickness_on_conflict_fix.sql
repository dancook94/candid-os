-- Align sickness calendar enqueue ON CONFLICT with partial unique index predicate (Test only).

BEGIN;

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
  ON CONFLICT (sickness_id) WHERE source_kind = 'sickness_recorded' AND sickness_id IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

COMMIT;
