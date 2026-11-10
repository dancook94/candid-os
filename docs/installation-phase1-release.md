# Installation Phase 1 — Test release gate

**Test project:** `axhkdwgmwhlbsstumndh`  
**Test app:** https://candid-os-test.vercel.app

## Migrations on Test (manual SQL Editor order)

1. `20270110163000_installation_management_phase1.sql`
2. `20270110164000_installation_phase1_hardening.sql` (if not superseded)
3. `20270110165000_installation_phase1_hardening_repair.sql`
4. `20270110166000_installation_phase1_table_select_grants.sql` — table `GRANT SELECT` for `authenticated` (RLS still gates rows)
5. `20270110167000_installation_phase1_rls_helper_grants.sql` — `GRANT EXECUTE` on `is_approved_installation_*` helpers used in RLS policies
6. `NOTIFY pgrst, 'reload schema';`

## Verification (in order)

1. **PostgREST / API** (local):  
   `node scripts/verify-installation-phase1-final.mjs`

2. **Postgres catalog** (SQL Editor, read-only):  
   `scripts/verify-installation-phase1-complete.sql`  
   Expect all rows `PASS` except `roles.matrix` and `reconcile.e2e` (`UNVERIFIED` until step 3).

3. **Security + reconcile** (rollback-only, not live JWT):  
   `DATABASE_URL='postgresql://postgres.<ref>:…' node scripts/verify-installation-phase1-roles.mjs`

4. **Release gate** (aggregates 1 + 3):  
   `node scripts/verify-installation-phase1-release.mjs`  
   Exit `0` required before deploy.

**Env:** Verification scripts **ignore Live shell exports** for PostgREST and always read `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from **`.env.vercel.test.local`** when that file exists (the URL does not need to contain the project ref substring). `DATABASE_URL` for Postgres role tests still needs `axhkdwgmwhlbsstumndh` in the connection string (shell or `.env.local`). No secrets are printed.

Checklist item 11 now expects Phase 2 acceptance to call `installation_reconcile_accepted_job`. Phase 2 migration `20270110168000_installation_phase2_acceptance.sql` is applied on Test separately and is not part of the Phase 1 list above.

## Deploy

Only after release gate exits `0`. Test Vercel project only — not Live.
