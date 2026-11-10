# Candid OS — Test → Live release checklist (reusable)

Use this when promoting **verified Test** work to **Live**. Do not run Live steps until Test gate exit `0` and product sign-off.

Covers: **Installation Management Phase 1**, **Holiday & Absence**, **Gmail / historical & live invoice scanning**.

---

## 1. Pre-flight

- [ ] Test release gate exit `0` on branch slated for Live (`node scripts/verify-installation-phase1-release.mjs` where applicable).
- [ ] `npm test` and `npm run build` green on that commit.
- [ ] Live Supabase **backup** (point-in-time or manual snapshot) documented.
- [ ] Live Vercel deployment **rollback target** URL noted (`vercel ls` / dashboard).
- [ ] Change window communicated; **no** parallel Live schema drift during apply.

---

## 2. Migrations (Live SQL Editor — forward only)

Apply in order; run `NOTIFY pgrst, 'reload schema';` after installation batches.

### Installation Management Phase 1

1. `20270110163000_installation_management_phase1.sql`
2. `20270110164000_installation_phase1_hardening.sql` *or* skip if using repair-only path below*
3. `20270110165000_installation_phase1_hardening_repair.sql` (recommended single hardening apply)
4. `20270110166000_installation_phase1_table_select_grants.sql`
5. `20270110167000_installation_phase1_rls_helper_grants.sql`

**Verification (read-only):** `scripts/verify-installation-phase1-complete.sql` in Live SQL Editor — expect PASS on catalog rows (role matrix / reconcile e2e remain script-driven).

**Never** on Live: re-run partial 163000 if objects already exist without comparing `pg_proc` / table list.

### Holiday & Absence

- Apply only migrations **not yet on Live** from `supabase/migrations/` matching `staff_leave_*` / calendar-sync (compare Live migration log vs repo).
- Controlled cron / notification docs: `docs/staff-leave-controlled-*-test.md` — adapt URLs to Live, keep `GCAL_ENABLED` policy.

### Gmail / invoice scanning

- Apply only invoice/gmail migrations **not yet on Live** (materials, processing runs, bulk review).
- **Do not** enable destructive reprocessing on Live without dry-run on Test.

---

## 3. Environment (Live Vercel project)

- [ ] `NEXT_PUBLIC_SUPABASE_URL` = Live project (not Test ref `axhkdwgmwhlbsstumndh`).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` / anon keys match Live project.
- [ ] `NEXT_PUBLIC_APP_ENV=production` (or org convention).
- [ ] Gmail OAuth / `GMAIL_*` — Live Google Cloud credentials only on Live.
- [ ] Staff leave: `STAFF_LEAVE_GCAL_*` — production calendar IDs; confirm `GCAL_ENABLED` before enabling crons.
- [ ] Cron secrets (`CRON_SECRET`) unique per environment.
- [ ] **No** Test `.env.vercel.test.local` copied to Live.

**Verification:** smoke login (staff + customer), one read-only API health check; no secrets in logs.

---

## 4. Automated tests (local / CI)

- [ ] `npm test`
- [ ] `npm run build`
- [ ] Domain-specific: `lib/installations/*`, `lib/gmail/*`, `lib/staff-leave/*` suites relevant to release.

---

## 5. Feature-specific Live checks (post-deploy)

### Installation Management Phase 1

- [ ] Admin: create manual project, schedule visit, assign production.
- [ ] Production: operational progress, sign-off; **cannot** schedule/reopen.
- [ ] Sales: read project/visit; **cannot** mutate.
- [ ] Storage bucket `installation-files` private; upload path validation.
- [ ] Quote reconcile: accepted job with install line → project + unscheduled visit (idempotent).

### Holiday & Absence

- [ ] Request / approve / cancel flow; notifications per settings.
- [ ] Calendar sync: outbox drain with production provider (or mock flag off only after validation).

### Gmail / invoices

- [ ] OAuth connect (admin); discovery does not scan Live mailbox until confirmed.
- [ ] Single-invoice promote; bulk review; no duplicate historical price corruption.

---

## 6. Deployment sequencing

1. **Database migrations** (Live) → `NOTIFY pgrst, 'reload schema';`
2. **Merge** approved PR to Live tracking branch.
3. **Vercel promote / deploy** Live project only (not `candid-os-test`).
4. **Post-deploy** smoke (section 5).
5. **Enable crons** only after smoke (installation N/A Phase 1; staff-leave / gmail per runbooks).

---

## 7. Rollback

| Layer | Action |
|--------|--------|
| Vercel | Instant rollback to previous deployment alias |
| Postgres | **No** destructive down-migration; restore from backup if schema/data bad |
| Feature flags | Disable crons (`GCAL_ENABLED=false`, pause gmail cron routes) to stop writes |

Installation Phase 1 rollback on Live: prefer **stop deploy + disable UI routes** over dropping tables.

---

## 8. Sign-off

- [ ] Daniel / ops confirms Test gate + Live smoke.
- [ ] Commit hash and Live deployment URL recorded.
- [ ] Outstanding UNVERIFIED items documented or accepted.

**Test reference:** `axhkdwgmwhlbsstumndh` · **Test app:** https://candid-os-test.vercel.app  
**Live:** deploy only from approved process above — never from Test credentials.
