-- Post-apply verification for 20270110165000_installation_phase1_hardening_repair.sql
-- Run in Test SQL Editor AFTER repair + NOTIFY pgrst, 'reload schema'; (read-only).

-- Expect 4 rows (all hardening helpers + manager reopen)
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'installation_storage_visit_id_from_path',
    'installation_storage_path_is_valid',
    'installation_visit_exists',
    'installation_visit_manager_reopen'
  )
ORDER BY p.proname;

-- Expect visit_reopened in constraint definition
SELECT pg_get_constraintdef(c.oid) AS visit_events_type_check
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'installation_visit_events'
  AND c.conname = 'installation_visit_events_type_check';

-- Expect storage policies referencing path validation + visit exists (not baseline-only UUID parse)
SELECT
  policyname,
  qual::text AS using_clause,
  with_check::text AS with_check_clause
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN (
    'installation_files_select_reader',
    'installation_files_insert_operator'
  )
ORDER BY policyname;

-- Manager reopen: catalog registration + GRANT target (three input types, default on third)
SELECT
  to_regprocedure('public.installation_visit_manager_reopen(uuid, text, text)') IS NOT NULL
    AS reopen_regprocedure_three_arg,
  pg_get_function_identity_arguments(p.oid) AS reopen_identity_arguments,
  has_function_privilege(
    'authenticated',
  p.oid,
    'EXECUTE'
  ) AS authenticated_can_reopen
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'installation_visit_manager_reopen';

-- Operational progress body should include terminal guard (presence in pg_proc source via catalog)
SELECT strpos(pg_get_functiondef(p.oid)::text, 'Completed or cancelled visits cannot be changed') > 0
  AS operational_terminal_guard_present
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'installation_visit_operational_progress';
