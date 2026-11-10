-- Installation Phase 1 — consolidated verification (Test: axhkdwgmwhlbsstumndh).
-- PART 1: Read-only pg_catalog / grants / storage (safe anytime).
-- PART 2: Rollback-only security + reconcile simulation — run via:
--   DATABASE_URL='…' node scripts/verify-installation-phase1-roles.mjs
-- PostgREST/API: node scripts/verify-installation-phase1-final.mjs
-- No psql meta-commands.

-- ===========================================================================
-- VERDICT SUMMARY (read first)
-- ===========================================================================
WITH checks AS (
  SELECT 'schema.tables' AS check_id, 'Eight installation tables' AS label,
    (SELECT count(*)::int FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN (
       'installation_projects', 'installation_visits', 'installation_visit_assignments',
       'installation_visit_documents', 'installation_visit_photos', 'installation_snag_items',
       'installation_sign_offs', 'installation_visit_events'
     )) = 8 AS ok
  UNION ALL
  SELECT 'schema.rls', 'RLS enabled on all installation tables',
    coalesce((SELECT bool_and(c.relrowsecurity) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'installation_%'
        AND c.relname IN (
          'installation_projects','installation_visits','installation_visit_assignments',
          'installation_visit_documents','installation_visit_photos','installation_snag_items',
          'installation_sign_offs','installation_visit_events'
        )), false)
  UNION ALL
  SELECT 'schema.rls_helpers', 'authenticated EXECUTE on installation RLS helpers',
    (SELECT count(*)::int FROM unnest(ARRAY[
      'public.is_approved_installation_reader()',
      'public.is_approved_installation_operator()',
      'public.is_approved_installation_manager()'
    ]) AS fn(sig)
    WHERE has_function_privilege('authenticated', sig, 'EXECUTE')) = 3
  UNION ALL
  SELECT 'schema.select_grants', 'authenticated SELECT on all installation tables',
    (SELECT count(*)::int FROM unnest(ARRAY[
      'installation_projects', 'installation_visits', 'installation_visit_assignments',
      'installation_visit_documents', 'installation_visit_photos', 'installation_snag_items',
      'installation_sign_offs', 'installation_visit_events'
    ]) AS t(table_name)
    WHERE has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')) = 8
  UNION ALL
  SELECT 'schema.indexes', 'job_id unique + visit number unique indexes',
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public'
      AND indexname IN ('installation_projects_job_id_unique_idx', 'installation_visits_unique_number')) = 2
  UNION ALL
  SELECT 'hardening.functions', 'Four hardening helper RPCs in pg_proc',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'installation_storage_visit_id_from_path',
       'installation_storage_path_is_valid',
       'installation_visit_exists',
       'installation_visit_manager_reopen'
     )) = 4
  UNION ALL
  SELECT 'hardening.event_type', 'visit_reopened allowed on installation_visit_events',
    coalesce((SELECT pg_get_constraintdef(c.oid) LIKE '%visit_reopened%'
      FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND rel.relname = 'installation_visit_events'
        AND c.conname = 'installation_visit_events_type_check'), false)
  UNION ALL
  SELECT 'hardening.terminal_guard', 'Operational progress blocks completed/cancelled',
    coalesce((SELECT strpos(pg_get_functiondef(p.oid)::text, 'Completed or cancelled visits cannot be changed') > 0
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'installation_visit_operational_progress'), false)
  UNION ALL
  SELECT 'hardening.reopen_grant', 'authenticated EXECUTE on manager reopen',
    coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'installation_visit_manager_reopen'), false)
  UNION ALL
  SELECT 'security.append_event', 'authenticated cannot EXECUTE append_visit_event',
    NOT coalesce(has_function_privilege(
      'authenticated', 'public.installation_append_visit_event(uuid,text,jsonb)', 'EXECUTE'), true)
  UNION ALL
  SELECT 'storage.bucket', 'installation-files bucket private',
    coalesce((SELECT NOT public FROM storage.buckets WHERE id = 'installation-files'), false)
  UNION ALL
  SELECT 'storage.policies', 'Storage policies use path + visit checks',
    (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN ('installation_files_select_reader', 'installation_files_insert_operator')
       AND (coalesce(qual::text, '') || coalesce(with_check::text, '')) LIKE '%installation_storage_path_is_valid%') >= 2
  UNION ALL
  SELECT 'detection.delivery_only', 'Delivery-only line does not qualify',
    public.installation_quote_line_qualifies('Delivery to site') = false
  UNION ALL
  SELECT 'detection.install_line', 'Installation line qualifies',
    public.installation_quote_line_qualifies('Site installation and fixings') = true
  UNION ALL
  SELECT 'roles.matrix', 'Role matrix (Postgres JWT claim simulation)',
    false
  UNION ALL
  SELECT 'reconcile.e2e', 'Reconcile idempotency + manual visit preservation',
    false
)
SELECT
  check_id,
  label,
  CASE
    WHEN check_id IN ('roles.matrix', 'reconcile.e2e') THEN 'UNVERIFIED'
    WHEN ok THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  CASE
    WHEN check_id IN ('roles.matrix', 'reconcile.e2e')
      THEN 'Run: DATABASE_URL=… node scripts/verify-installation-phase1-roles.mjs (ROLLBACK-only; not a substitute for live JWT)'
    WHEN ok THEN NULL
    ELSE 'Inspect detail sections below'
  END AS detail
FROM checks
ORDER BY check_id;

-- ===========================================================================
-- DETAIL: Tables
-- ===========================================================================
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'installation_%'
ORDER BY table_name;

-- ===========================================================================
-- DETAIL: Key indexes
-- ===========================================================================
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('installation_projects_job_id_unique_idx', 'installation_visits_unique_number');

-- ===========================================================================
-- DETAIL: RLS policies (public)
-- ===========================================================================
SELECT c.relname AS table_name, pol.polname AS policy_name, pol.polcmd AS command
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'installation_%'
ORDER BY c.relname, pol.polname;

-- ===========================================================================
-- DETAIL: Installation RPCs + authenticated EXECUTE
-- ===========================================================================
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'installation_reconcile_for_job',
    'installation_project_create_manual',
    'installation_visit_create_admin',
    'installation_visit_admin_schedule',
    'installation_visit_assign_profile',
    'installation_visit_operational_progress',
    'installation_snag_upsert',
    'installation_sign_off_capture',
    'installation_register_visit_document',
    'installation_register_visit_photo',
    'installation_visit_manager_reopen'
  )
ORDER BY p.proname;

-- ===========================================================================
-- DETAIL: Triggers (client-write blocks, sign-off immutability)
-- ===========================================================================
SELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND (
    c.relname LIKE 'installation_%'
    OR p.proname LIKE 'installation_%'
  )
ORDER BY c.relname, t.tgname;

-- ===========================================================================
-- DETAIL: Storage bucket + policies
-- ===========================================================================
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'installation-files';

SELECT policyname, cmd, qual::text AS using_clause, with_check::text AS with_check_clause
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'installation_%'
ORDER BY policyname;
