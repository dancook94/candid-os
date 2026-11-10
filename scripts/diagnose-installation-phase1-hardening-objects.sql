-- Read-only: which 164000 / 165000 hardening objects exist on Test? Paste into SQL Editor.

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

SELECT pg_get_constraintdef(c.oid) AS visit_events_type_check
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'installation_visit_events'
  AND c.conname = 'installation_visit_events_type_check';

SELECT policyname
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'installation_files_%'
ORDER BY policyname;
