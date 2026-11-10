-- Installation Phase 1 read-only diagnostic (Test project axhkdwgmwhlbsstumndh).
-- Paste into Supabase Dashboard → SQL Editor → Run. No writes.

-- ---------------------------------------------------------------------------
-- 0. Summary (run this first)
-- ---------------------------------------------------------------------------
SELECT
  (
    SELECT count(*)::int
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'installation_projects',
        'installation_visits',
        'installation_visit_assignments',
        'installation_visit_documents',
        'installation_visit_photos',
        'installation_snag_items',
        'installation_sign_offs',
        'installation_visit_events'
      )
  ) AS installation_tables_found,
  8 AS installation_tables_expected,
  EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'installation_projects'
  ) AS installation_projects_exists,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'installation_reconcile_for_job'
  ) AS reconcile_rpc_in_postgres,
  (
    SELECT count(*)::int
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'installation_%'
  ) AS installation_public_rpc_count,
  EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'installation_visit_manager_reopen'
  ) AS hardening_reopen_rpc_present,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'installation_visit_exists'
  ) AS hardening_storage_visit_check_present,
  EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'installation-files'
  ) AS installation_files_bucket_exists,
  (
    SELECT count(*)::int
    FROM pg_policies pol
    WHERE pol.schemaname = 'storage'
      AND pol.tablename = 'objects'
      AND pol.policyname LIKE 'installation_%'
  ) AS installation_storage_policy_count,
  (
    SELECT bool_and(c.relrowsecurity)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'installation_projects',
        'installation_visits',
        'installation_visit_assignments',
        'installation_visit_documents',
        'installation_visit_photos',
        'installation_snag_items',
        'installation_sign_offs',
        'installation_visit_events'
      )
      AND c.relkind = 'r'
  ) AS all_installation_tables_rls_enabled,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'installation_append_visit_event'
    ) THEN has_function_privilege(
      'authenticated',
      'public.installation_append_visit_event(uuid,text,jsonb)',
      'EXECUTE'
    )
    ELSE NULL
  END AS append_event_auth_can_execute,
  EXISTS (
    SELECT 1 FROM information_schema.schemata
    WHERE schema_name = 'supabase_migrations'
  ) AS supabase_migrations_schema_exists;

-- If installation_tables_found = 8 AND reconcile_rpc_in_postgres = true but API returns PGRST202,
-- reload PostgREST schema: NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
SELECT
  t.table_name,
  t.table_type
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'installation_projects',
    'installation_visits',
    'installation_visit_assignments',
    'installation_visit_documents',
    'installation_visit_photos',
    'installation_snag_items',
    'installation_sign_offs',
    'installation_visit_events'
  )
ORDER BY t.table_name;

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
SELECT
  indexname,
  tablename,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    tablename LIKE 'installation_%'
    OR indexname LIKE 'installation_%'
  )
ORDER BY tablename, indexname;

-- Key partial / unique indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'installation_projects_job_id_unique_idx',
    'installation_visits_unique_number'
  );

-- ---------------------------------------------------------------------------
-- 3. Constraints
-- ---------------------------------------------------------------------------
SELECT
  rel.relname AS table_name,
  c.conname AS constraint_name,
  c.contype AS constraint_type
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname LIKE 'installation_%'
ORDER BY rel.relname, c.conname;

-- ---------------------------------------------------------------------------
-- 4. RLS enabled per table
-- ---------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'installation_projects',
    'installation_visits',
    'installation_visit_assignments',
    'installation_visit_documents',
    'installation_visit_photos',
    'installation_snag_items',
    'installation_sign_offs',
    'installation_visit_events'
  )
  AND c.relkind = 'r'
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- 5. RLS policies (public installation tables)
-- ---------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  pol.polname AS policy_name,
  pol.polcmd AS command,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'installation_%'
ORDER BY c.relname, pol.polname;

-- ---------------------------------------------------------------------------
-- 6. Installation RPCs in Postgres
-- ---------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'installation_%'
ORDER BY p.proname, arguments;

-- ---------------------------------------------------------------------------
-- 7. EXECUTE privileges (authenticated / service_role / anon)
-- ---------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'installation_%'
ORDER BY p.proname, arguments;

-- Append-only event helper must NOT be callable by authenticated
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'installation_append_visit_event';

-- ---------------------------------------------------------------------------
-- 8. Access helper functions
-- ---------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_approved_installation_reader',
    'is_approved_installation_manager',
    'is_approved_installation_operator',
    'installation_block_direct_client_write',
    'installation_is_delivery_only_line',
    'installation_quote_line_qualifies',
    'installation_version_requires_project',
    'storage_installation_visit_id_from_path'
  )
ORDER BY p.proname;

-- ---------------------------------------------------------------------------
-- 9. Triggers on installation tables
-- ---------------------------------------------------------------------------
SELECT
  t.tgname AS trigger_name,
  c.relname AS table_name,
  p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'installation_%'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- ---------------------------------------------------------------------------
-- 10. Storage bucket
-- ---------------------------------------------------------------------------
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'installation-files';

-- ---------------------------------------------------------------------------
-- 11. Storage policies (installation-files)
-- ---------------------------------------------------------------------------
SELECT
  policyname,
  cmd,
  qual::text AS using_clause,
  with_check::text AS with_check_clause
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'installation_%'
ORDER BY policyname;

-- ---------------------------------------------------------------------------
-- 12. reconcile RPC detail (PostgREST exposure depends on schema cache)
-- ---------------------------------------------------------------------------
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'installation_reconcile_for_job';

-- ---------------------------------------------------------------------------
-- 13. Supabase migration history (optional second query)
-- Only run the block below if summary shows supabase_migrations_schema_exists = true.
-- ---------------------------------------------------------------------------
/*
SELECT
  version,
  name
FROM supabase_migrations.schema_migrations
WHERE name ILIKE '%installation%'
   OR version::text LIKE '%20270110163%'
   OR version::text LIKE '%20270110164%'
ORDER BY version;
*/
