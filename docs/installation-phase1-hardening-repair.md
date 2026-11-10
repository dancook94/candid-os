# Installation Phase 1 — hardening repair (Test)

**When to use:** `pg_proc` shows none of the 164000 hardening functions (e.g. `installation_visit_manager_reopen`, `installation_visit_exists`).

**Prerequisite:** `20270110163000_installation_management_phase1.sql` applied on Test (`axhkdwgmwhlbsstumndh`).

**Do not** re-run 163000 or `20270110164000` if repair is used.

## Apply

1. Supabase Dashboard → Test project → **SQL Editor**.
2. Paste the full file:

   `supabase/migrations/20270110165000_installation_phase1_hardening_repair.sql`

3. **Run** once. Expect a single success (one transaction).
4. Reload API schema:

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

5. Paste and run (read-only):

   `scripts/verify-installation-phase1-hardening-repair.sql`

6. Locally:

   ```bash
   node scripts/verify-installation-phase1-final.mjs
   ```

   Optional with `DATABASE_URL`: `node scripts/verify-installation-phase1-roles.mjs`

## 164000 delta (what repair restores)

| Category | Change vs 163000 |
|----------|------------------|
| New functions | `installation_storage_visit_id_from_path`, `installation_storage_path_is_valid`, `installation_visit_exists` |
| Replaced RPCs | `installation_register_visit_document`, `installation_register_visit_photo`, `installation_visit_operational_progress`, `installation_snag_upsert` |
| New RPC | `installation_visit_manager_reopen` |
| Constraint | `installation_visit_events_type_check` adds `visit_reopened` |
| Storage policies | `installation_files_select_reader`, `installation_files_insert_operator` require valid path + existing visit |
| Grants | `GRANT EXECUTE` on `installation_visit_manager_reopen(uuid, text, text)` to `authenticated` (same pattern as `installation_visit_create_admin`) |
| Revoke | `installation_visit_exists(uuid)` from PUBLIC/anon/authenticated (internal helper) |

Unchanged from 163000: tables, triggers, `installation_files_delete_manager`, bucket definition, 163000 RPC grants (preserved by `CREATE OR REPLACE`).
