-- Installation Phase 3: multi-select quote classification, scheduling conflicts,
-- and project status. Test only (axhkdwgmwhlbsstumndh).
-- Does not keyword-backfill historical NULL lines and does not insert projects.
-- Does not write Holiday & Absence rows or the Google Calendar outbox.
-- Apply after 20270110168000. Then NOTIFY pgrst, 'reload schema';

BEGIN;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS requires_print_supply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_installation boolean NOT NULL DEFAULT false;

-- Map an existing single class onto one flag. NULL rows stay all false.
UPDATE public.quote_items
SET
  requires_print_supply = work_class = 'print_supply',
  requires_delivery = work_class = 'delivery',
  requires_installation = work_class = 'installation'
WHERE work_class IS NOT NULL;

CREATE OR REPLACE FUNCTION public.installation_version_requires_project(p_quote_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.quote_items qi
    WHERE qi.quote_version_id = p_quote_version_id
      AND public.installation_quote_item_in_version(qi)
      AND (
        qi.requires_installation
        OR qi.work_class = 'installation'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.installation_version_requires_project(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conflict helpers. Not granted to clients.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_leave_portion_overlaps(
  p_portion text,
  p_start_date date,
  p_end_date date,
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_portion = 'full' THEN
      p_end_date >= (p_window_start AT TIME ZONE 'Europe/London')::date
      AND p_start_date <= ((p_window_end - interval '1 microsecond') AT TIME ZONE 'Europe/London')::date
    WHEN p_portion = 'am' AND p_start_date = p_end_date THEN
      p_window_start < ((p_start_date::timestamp + time '12:00') AT TIME ZONE 'Europe/London')
      AND (p_start_date::timestamp AT TIME ZONE 'Europe/London') < p_window_end
    WHEN p_portion = 'pm' AND p_start_date = p_end_date THEN
      p_window_start < (((p_start_date + 1)::timestamp) AT TIME ZONE 'Europe/London')
      AND ((p_start_date::timestamp + time '12:00') AT TIME ZONE 'Europe/London') < p_window_end
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.installation_window_end(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_start IS NULL THEN NULL
    WHEN p_end IS NOT NULL AND p_end > p_start THEN p_end
    ELSE (((p_start AT TIME ZONE 'Europe/London')::date + 1)::timestamp AT TIME ZONE 'Europe/London')
  END;
$$;

CREATE OR REPLACE FUNCTION public.installation_lock_schedule_keys(
  p_visit_id uuid,
  p_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  FOR v_key IN
    SELECT key
    FROM (
      SELECT 'v:' || p_visit_id::text AS key
      UNION
      SELECT 'p:' || profile_id::text
      FROM unnest(coalesce(p_profile_ids, ARRAY[]::uuid[])) AS profile_id
      WHERE profile_id IS NOT NULL
    ) keys
    ORDER BY key
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('candid.installation.schedule'),
      hashtext(v_key)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_collect_conflicts(
  p_visit_id uuid,
  p_profile_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_conflicts jsonb;
BEGIN
  IF p_start IS NULL OR coalesce(array_length(p_profile_ids, 1), 0) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_start := p_start;
  v_end := public.installation_window_end(p_start, p_end);

  IF v_end IS NULL OR v_end <= v_start THEN
    RAISE EXCEPTION 'Visit end must be after the start.';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'kind', item->>'profile_name'), '[]'::jsonb)
  INTO v_conflicts
  FROM (
    SELECT jsonb_build_object(
      'kind', 'installation',
      'profile_id', a.profile_id,
      'profile_name', coalesce(p.full_name, 'Installer'),
      'visit_id', v.id,
      'visit_title', v.title,
      'project_id', ip.id,
      'project_title', ip.title,
      'scheduled_start_at', v.scheduled_start_at,
      'scheduled_end_at', v.scheduled_end_at
    ) AS item
    FROM public.installation_visit_assignments a
    JOIN public.installation_visits v ON v.id = a.installation_visit_id
    JOIN public.installation_projects ip ON ip.id = v.installation_project_id
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.profile_id = ANY(p_profile_ids)
      AND v.id IS DISTINCT FROM p_visit_id
      AND v.status IN ('scheduled', 'en_route', 'on_site')
      AND v.scheduled_start_at IS NOT NULL
      AND v_start < public.installation_window_end(v.scheduled_start_at, v.scheduled_end_at)
      AND v.scheduled_start_at < v_end

    UNION ALL

    SELECT jsonb_build_object(
      'kind', 'leave',
      'profile_id', r.profile_id,
      'profile_name', coalesce(p.full_name, 'Staff'),
      'start_date', r.start_date,
      'end_date', r.end_date,
      'day_portion', r.day_portion
    )
    FROM public.staff_leave_requests r
    JOIN public.profiles p ON p.id = r.profile_id
    WHERE r.profile_id = ANY(p_profile_ids)
      AND r.status = 'approved'
      AND public.installation_leave_portion_overlaps(
        r.day_portion, r.start_date, r.end_date, v_start, v_end
      )

    UNION ALL

    SELECT jsonb_build_object(
      'kind', 'absence',
      'profile_id', s.profile_id,
      'profile_name', coalesce(p.full_name, 'Staff'),
      'start_date', s.start_date,
      'end_date', s.end_date,
      'day_portion', s.day_portion
    )
    FROM public.staff_absence_sickness s
    JOIN public.profiles p ON p.id = s.profile_id
    WHERE s.profile_id = ANY(p_profile_ids)
      AND public.installation_leave_portion_overlaps(
        s.day_portion, s.start_date, s.end_date, v_start, v_end
      )
  ) conflicts;

  RETURN v_conflicts;
END;
$$;

REVOKE ALL ON FUNCTION public.installation_leave_portion_overlaps(text, date, date, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installation_window_end(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installation_lock_schedule_keys(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installation_collect_conflicts(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read-only unavailability. No sickness reason, note, or private note.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_team_unavailability(
  p_start date,
  p_end date
)
RETURNS TABLE (
  profile_id uuid,
  profile_name text,
  kind text,
  start_date date,
  end_date date,
  day_portion text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.installation_assert_reader();

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'A valid date range is required.';
  END IF;

  IF p_end > p_start + 400 THEN
    RAISE EXCEPTION 'Date range is too long.';
  END IF;

  RETURN QUERY
  SELECT
    r.profile_id,
    coalesce(p.full_name, 'Staff'),
    'leave'::text,
    r.start_date,
    r.end_date,
    r.day_portion
  FROM public.staff_leave_requests r
  JOIN public.profiles p ON p.id = r.profile_id
  WHERE r.status = 'approved'
    AND r.end_date >= p_start
    AND r.start_date <= p_end

  UNION ALL

  SELECT
    s.profile_id,
    coalesce(p.full_name, 'Staff'),
    'absence'::text,
    s.start_date,
    s.end_date,
    s.day_portion
  FROM public.staff_absence_sickness s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.end_date >= p_start
    AND s.start_date <= p_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_preview_schedule_conflicts(
  p_visit_id uuid,
  p_profile_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.installation_assert_manager();

  RETURN public.installation_collect_conflicts(
    p_visit_id,
    coalesce(p_profile_ids, ARRAY[]::uuid[]),
    p_start,
    p_end
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_commit_schedule(
  p_visit_id uuid,
  p_status text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_title text,
  p_purpose text,
  p_site_label text,
  p_site_recipient_name text,
  p_site_address_line_1 text,
  p_site_address_line_2 text,
  p_site_city text,
  p_site_county text,
  p_site_postcode text,
  p_site_country text,
  p_site_phone text,
  p_access_instructions text,
  p_on_site_contact_name text,
  p_on_site_contact_phone text,
  p_acknowledge boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status text;
  v_profile_ids uuid[];
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_status NOT IN ('unscheduled', 'scheduled', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid administrative status.';
  END IF;

  IF p_status = 'scheduled' AND p_scheduled_start_at IS NULL THEN
    RAISE EXCEPTION 'A scheduled visit needs a start time.';
  END IF;

  IF p_scheduled_start_at IS NOT NULL
    AND p_scheduled_end_at IS NOT NULL
    AND p_scheduled_end_at <= p_scheduled_start_at THEN
    RAISE EXCEPTION 'Visit end must be after the start.';
  END IF;

  SELECT coalesce(array_agg(a.profile_id ORDER BY a.profile_id), ARRAY[]::uuid[])
  INTO v_profile_ids
  FROM public.installation_visit_assignments a
  WHERE a.installation_visit_id = p_visit_id;

  PERFORM public.installation_lock_schedule_keys(p_visit_id, v_profile_ids);

  SELECT status INTO v_prev_status
  FROM public.installation_visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found.';
  END IF;

  SELECT coalesce(array_agg(a.profile_id ORDER BY a.profile_id), ARRAY[]::uuid[])
  INTO v_profile_ids
  FROM public.installation_visit_assignments a
  WHERE a.installation_visit_id = p_visit_id;

  PERFORM public.installation_lock_schedule_keys(p_visit_id, v_profile_ids);

  IF p_status = 'scheduled' THEN
    v_conflicts := public.installation_collect_conflicts(
      p_visit_id,
      v_profile_ids,
      p_scheduled_start_at,
      p_scheduled_end_at
    );

    IF jsonb_array_length(v_conflicts) > 0 AND p_acknowledge IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'saved', false,
        'conflicts', v_conflicts
      );
    END IF;
  END IF;

  UPDATE public.installation_visits
  SET
    status = p_status,
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_end_at,
    title = coalesce(nullif(btrim(p_title), ''), title),
    purpose = coalesce(p_purpose, purpose),
    site_label = p_site_label,
    site_recipient_name = p_site_recipient_name,
    site_address_line_1 = p_site_address_line_1,
    site_address_line_2 = p_site_address_line_2,
    site_city = p_site_city,
    site_county = p_site_county,
    site_postcode = p_site_postcode,
    site_country = coalesce(nullif(btrim(p_site_country), ''), 'GB'),
    site_phone = p_site_phone,
    access_instructions = p_access_instructions,
    on_site_contact_name = p_on_site_contact_name,
    on_site_contact_phone = p_on_site_contact_phone
  WHERE id = p_visit_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    CASE WHEN p_status = 'scheduled' THEN 'scheduled' ELSE 'status_changed' END,
    jsonb_build_object(
      'previous_status', v_prev_status,
      'new_status', p_status,
      'scheduled_start_at', p_scheduled_start_at,
      'scheduled_end_at', p_scheduled_end_at,
      'conflicts_acknowledged', p_acknowledge IS TRUE AND jsonb_array_length(v_conflicts) > 0,
      'conflicts', v_conflicts
    )
  );

  RETURN jsonb_build_object(
    'saved', true,
    'conflicts', v_conflicts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_assign_confirmed(
  p_visit_id uuid,
  p_profile_id uuid,
  p_remove boolean,
  p_acknowledge boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_start timestamptz;
  v_end timestamptz;
  v_conflicts jsonb := '[]'::jsonb;
  v_assignment_id uuid;
  v_removed integer;
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Installer is required.';
  END IF;

  PERFORM public.installation_lock_schedule_keys(p_visit_id, ARRAY[p_profile_id]);

  SELECT status, scheduled_start_at, scheduled_end_at
  INTO v_status, v_start, v_end
  FROM public.installation_visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found.';
  END IF;

  IF p_remove THEN
    DELETE FROM public.installation_visit_assignments
    WHERE installation_visit_id = p_visit_id
      AND profile_id = p_profile_id;

    GET DIAGNOSTICS v_removed = ROW_COUNT;

    IF v_removed > 0 THEN
      PERFORM public.installation_append_visit_event(
        p_visit_id,
        'assignment_removed',
        jsonb_build_object('profile_id', p_profile_id)
      );
    END IF;

    RETURN jsonb_build_object('saved', true, 'conflicts', '[]'::jsonb);
  END IF;

  IF v_status IN ('scheduled', 'en_route', 'on_site') AND v_start IS NOT NULL THEN
    v_conflicts := public.installation_collect_conflicts(
      p_visit_id,
      ARRAY[p_profile_id],
      v_start,
      v_end
    );

    IF jsonb_array_length(v_conflicts) > 0 AND p_acknowledge IS NOT TRUE THEN
      RETURN jsonb_build_object('saved', false, 'conflicts', v_conflicts);
    END IF;
  END IF;

  INSERT INTO public.installation_visit_assignments (
    installation_visit_id,
    profile_id,
    assigned_by_profile_id
  )
  VALUES (p_visit_id, p_profile_id, auth.uid())
  ON CONFLICT (installation_visit_id, profile_id) DO NOTHING
  RETURNING id INTO v_assignment_id;

  IF v_assignment_id IS NOT NULL THEN
    PERFORM public.installation_append_visit_event(
      p_visit_id,
      'assignment_added',
      jsonb_build_object(
        'profile_id', p_profile_id,
        'conflicts_acknowledged', p_acknowledge IS TRUE AND jsonb_array_length(v_conflicts) > 0,
        'conflicts', v_conflicts
      )
    );
  END IF;

  RETURN jsonb_build_object('saved', true, 'conflicts', v_conflicts);
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_project_update_details(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_status text,
  p_acknowledge_completion boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unfinished integer;
  v_open_snags integer;
  v_current_status text;
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_status NOT IN ('draft', 'active', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid project status.';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Project title is required.';
  END IF;

  SELECT status INTO v_current_status
  FROM public.installation_projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installation project not found.';
  END IF;

  IF p_status = 'completed' AND v_current_status IS DISTINCT FROM 'completed' THEN
    SELECT count(*)::integer INTO v_unfinished
    FROM public.installation_visits
    WHERE installation_project_id = p_project_id
      AND status NOT IN ('completed', 'cancelled');

    SELECT count(*)::integer INTO v_open_snags
    FROM public.installation_snag_items s
    JOIN public.installation_visits v ON v.id = s.installation_visit_id
    WHERE v.installation_project_id = p_project_id
      AND s.status = 'open';

    IF (v_unfinished > 0 OR v_open_snags > 0) AND p_acknowledge_completion IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'saved', false,
        'unfinished_visits', v_unfinished,
        'open_snags', v_open_snags
      );
    END IF;
  END IF;

  UPDATE public.installation_projects
  SET
    title = btrim(p_title),
    description = p_description,
    status = p_status
  WHERE id = p_project_id;

  RETURN jsonb_build_object(
    'saved', true,
    'unfinished_visits', 0,
    'open_snags', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.installation_team_unavailability(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_preview_schedule_conflicts(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_visit_commit_schedule(uuid, text, timestamptz, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_visit_assign_confirmed(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_project_update_details(uuid, text, text, text, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.installation_team_unavailability(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_preview_schedule_conflicts(uuid, uuid[], timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_visit_commit_schedule(uuid, text, timestamptz, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_visit_assign_confirmed(uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_project_update_details(uuid, text, text, text, boolean) TO authenticated;

COMMIT;
