-- Installation completion report customer portal, publishing, and delivery.
-- Test only. Saved report PDFs remain append-only and are never regenerated on publish.
-- Managers publish deliberately; customers see only the current published report per visit.

BEGIN;

CREATE TABLE IF NOT EXISTS public.installation_visit_published_reports (
  installation_visit_id uuid PRIMARY KEY REFERENCES public.installation_visits (id) ON DELETE CASCADE,
  installation_completion_report_id uuid NOT NULL UNIQUE REFERENCES public.installation_completion_reports (id),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by_profile_id uuid NOT NULL REFERENCES public.profiles (id)
);

CREATE INDEX IF NOT EXISTS installation_visit_published_reports_report_idx
  ON public.installation_visit_published_reports (installation_completion_report_id);

CREATE TABLE IF NOT EXISTS public.installation_completion_report_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id uuid NOT NULL REFERENCES public.installation_visits (id) ON DELETE CASCADE,
  installation_completion_report_id uuid NOT NULL REFERENCES public.installation_completion_reports (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id),
  previous_report_id uuid REFERENCES public.installation_completion_reports (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_report_publication_events_type_check
    CHECK (event_type IN ('published', 'unpublished', 'replaced'))
);

CREATE INDEX IF NOT EXISTS installation_report_publication_events_visit_idx
  ON public.installation_completion_report_publication_events (installation_visit_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.installation_completion_report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_completion_report_id uuid NOT NULL REFERENCES public.installation_completion_reports (id) ON DELETE CASCADE,
  report_reference text NOT NULL,
  version_number integer NOT NULL,
  recipient_email text NOT NULL,
  sent_by_profile_id uuid NOT NULL REFERENCES public.profiles (id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  attach_pdf boolean NOT NULL DEFAULT false,
  customer_message text,
  notification_id uuid REFERENCES public.notifications (id),
  provider_status text,
  provider_message_id text,
  error_message text,
  idempotency_key text UNIQUE,
  CONSTRAINT installation_report_deliveries_version_positive CHECK (version_number > 0),
  CONSTRAINT installation_report_deliveries_reference_not_blank CHECK (btrim(report_reference) <> '')
);

CREATE INDEX IF NOT EXISTS installation_report_deliveries_report_idx
  ON public.installation_completion_report_deliveries (installation_completion_report_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.installation_publish_completion_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_id uuid;
  v_previous_report_id uuid;
  v_published_at timestamptz;
  v_published_by uuid;
BEGIN
  PERFORM public.installation_assert_manager();

  SELECT installation_visit_id
  INTO v_visit_id
  FROM public.installation_completion_reports
  WHERE id = p_report_id;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'Report not found.';
  END IF;

  SELECT installation_completion_report_id, published_at, published_by_profile_id
  INTO v_previous_report_id, v_published_at, v_published_by
  FROM public.installation_visit_published_reports
  WHERE installation_visit_id = v_visit_id
  FOR UPDATE;

  IF v_previous_report_id = p_report_id THEN
    RETURN jsonb_build_object(
      'saved', true,
      'published', true,
      'installation_visit_id', v_visit_id,
      'installation_completion_report_id', p_report_id,
      'published_at', v_published_at,
      'published_by_profile_id', v_published_by
    );
  END IF;

  INSERT INTO public.installation_visit_published_reports (
    installation_visit_id,
    installation_completion_report_id,
    published_at,
    published_by_profile_id
  )
  VALUES (v_visit_id, p_report_id, now(), auth.uid())
  ON CONFLICT (installation_visit_id) DO UPDATE
  SET
    installation_completion_report_id = EXCLUDED.installation_completion_report_id,
    published_at = EXCLUDED.published_at,
    published_by_profile_id = EXCLUDED.published_by_profile_id;

  IF v_previous_report_id IS NOT NULL AND v_previous_report_id IS DISTINCT FROM p_report_id THEN
    INSERT INTO public.installation_completion_report_publication_events (
      installation_visit_id,
      installation_completion_report_id,
      event_type,
      actor_profile_id,
      previous_report_id
    )
    VALUES (v_visit_id, p_report_id, 'replaced', auth.uid(), v_previous_report_id);
  ELSE
    INSERT INTO public.installation_completion_report_publication_events (
      installation_visit_id,
      installation_completion_report_id,
      event_type,
      actor_profile_id
    )
    VALUES (v_visit_id, p_report_id, 'published', auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'saved', true,
    'published', true,
    'installation_visit_id', v_visit_id,
    'installation_completion_report_id', p_report_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_unpublish_completion_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_id uuid;
  v_current_report_id uuid;
BEGIN
  PERFORM public.installation_assert_manager();

  SELECT installation_visit_id
  INTO v_visit_id
  FROM public.installation_completion_reports
  WHERE id = p_report_id;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'Report not found.';
  END IF;

  SELECT installation_completion_report_id
  INTO v_current_report_id
  FROM public.installation_visit_published_reports
  WHERE installation_visit_id = v_visit_id
  FOR UPDATE;

  IF v_current_report_id IS NULL THEN
    RETURN jsonb_build_object('saved', true, 'published', false);
  END IF;

  IF v_current_report_id IS DISTINCT FROM p_report_id THEN
    RAISE EXCEPTION 'This report is not currently published.';
  END IF;

  DELETE FROM public.installation_visit_published_reports
  WHERE installation_visit_id = v_visit_id;

  INSERT INTO public.installation_completion_report_publication_events (
    installation_visit_id,
    installation_completion_report_id,
    event_type,
    actor_profile_id
  )
  VALUES (v_visit_id, p_report_id, 'unpublished', auth.uid());

  RETURN jsonb_build_object('saved', true, 'published', false);
END;
$$;

REVOKE ALL ON FUNCTION public.installation_publish_completion_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_unpublish_completion_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_publish_completion_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_unpublish_completion_report(uuid) TO authenticated;

DROP TRIGGER IF EXISTS installation_visit_published_reports_block_client ON public.installation_visit_published_reports;
CREATE TRIGGER installation_visit_published_reports_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_visit_published_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_report_publication_events_block_client ON public.installation_completion_report_publication_events;
CREATE TRIGGER installation_report_publication_events_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_completion_report_publication_events
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_report_deliveries_block_client ON public.installation_completion_report_deliveries;
CREATE TRIGGER installation_report_deliveries_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_completion_report_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

ALTER TABLE public.installation_visit_published_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_completion_report_publication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_completion_report_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installation_visit_published_reports_select_manager ON public.installation_visit_published_reports;
CREATE POLICY installation_visit_published_reports_select_manager
  ON public.installation_visit_published_reports FOR SELECT TO authenticated
  USING (public.is_approved_installation_manager());

DROP POLICY IF EXISTS installation_report_publication_events_select_manager ON public.installation_completion_report_publication_events;
CREATE POLICY installation_report_publication_events_select_manager
  ON public.installation_completion_report_publication_events FOR SELECT TO authenticated
  USING (public.is_approved_installation_manager());

DROP POLICY IF EXISTS installation_report_deliveries_select_manager ON public.installation_completion_report_deliveries;
CREATE POLICY installation_report_deliveries_select_manager
  ON public.installation_completion_report_deliveries FOR SELECT TO authenticated
  USING (public.is_approved_installation_manager());

GRANT SELECT ON TABLE public.installation_visit_published_reports TO authenticated, service_role;
GRANT SELECT ON TABLE public.installation_completion_report_publication_events TO authenticated, service_role;
GRANT SELECT ON TABLE public.installation_completion_report_deliveries TO authenticated, service_role;

COMMIT;
