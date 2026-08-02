# CRM Notes and Activity — Implementation Plan

**Status:** Migration proposed, application **not yet implemented**.

Apply `docs/proposed-crm-notes-activity-migration.sql` in Supabase (staging first), review this plan, then implement application changes in phases below. **Do not run SQL or backfill automatically.**

---

## Executive summary

| Question | Answer |
|----------|--------|
| Is a broader shared schema needed? | **Yes.** Only `opportunity_notes` and `opportunity_activity` exist today. They are opportunity-scoped and cannot serve company, contact, quote, or task pages without duplication. |
| Replace legacy tables now? | **No.** Keep `opportunity_notes` and `opportunity_activity` during transition. Backfill into `crm_notes` / `crm_activity`, then dual-write, then read from shared tables, then deprecate legacy. |
| Customer access? | **None.** Same as existing CRM RLS — production, accounts, and customers have no policies. |

---

## Schema audit (current state)

### `public.opportunity_notes`

Defined in `docs/proposed-crm-foundation-migration.sql`.

| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `opportunity_id` | NOT NULL FK → opportunities (CASCADE) |
| `body` | text, not blank |
| `created_by` | FK → profiles (RESTRICT) |
| `created_at`, `updated_at` | timestamptz |

**Missing vs requirements:** no `is_pinned`, no multi-record links, no soft delete, no `company_id` denormalisation.

**Index:** `(opportunity_id, created_at DESC)`.

**RLS:** admins full access; sales full CRUD on notes for `can_access_opportunity(opportunity_id)`.

**UI:** `OpportunityNoteForm` inserts directly via browser Supabase client. Opportunity detail page lists notes read-only — no edit, pin, or delete.

### `public.opportunity_activity`

Defined in `docs/proposed-crm-foundation-migration.sql`.

| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `opportunity_id` | NOT NULL FK → opportunities (CASCADE) |
| `activity_type` | text |
| `description` | text |
| `metadata` | jsonb default `{}` |
| `created_by` | nullable FK → profiles (**ON DELETE SET NULL**) |
| `created_at` | timestamptz |

**Missing vs requirements:** no company/contact/quote/task links; column named `created_by` not `actor_profile_id`.

**Indexes:** `(opportunity_id, created_at DESC)`, `(activity_type)`.

**RLS:** admins full access; sales **SELECT + INSERT only** (append-only).

### Related CRM schemas

| Table | Key link columns | Notes |
|-------|------------------|-------|
| `companies` | — | Master B2B account. No notes/activity tables. |
| `contacts` | `company_id`, `profile_id`, `is_primary`, `is_active`, `invited_at` | Inline `notes` text field is **contact profile data**, not staff CRM notes. |
| `opportunities` | `company_id`, `contact_id`, `owner_profile_id`, stage fields | `contact_id` from contacts migration. |
| `quotes` | `company_id`, `opportunity_id`, `contact_id` | Quote version fields include `customer_notes` / `internal_notes` — **quote document content**, not CRM timeline notes. |
| `tasks` | `company_id`, `opportunity_id`, `quote_id`, `assigned_to`, `created_by` | `quote_id` requires `opportunity_id`. |

### Existing activity writes (centralise in Phase 4)

**Central helper today:** `logOpportunityActivity()` in `lib/crm/opportunity-stage-sync.ts` → inserts `opportunity_activity`.

**Types defined:** `lib/crm/activity-types.ts` (`OPPORTUNITY_ACTIVITY_TYPES`).

| Location | Events logged |
|----------|---------------|
| `lib/crm/opportunity-contact.ts` | `opportunity_created`, `contact_changed` |
| `lib/crm/opportunity-linking.ts` | `opportunity_created` |
| `lib/crm/opportunity-assignments.ts` | `owner_changed`, `collaborator_added`, `collaborator_removed` |
| `lib/crm/opportunity-stage-sync.ts` | `stage_changed`, `quote_created`, `task_created` (follow-up) |
| `lib/crm/link-quote-opportunity.ts` | `quote_linked` |
| `lib/crm/task-assignees.ts` | `task_assignee_added`, `task_assignee_removed` |
| `app/api/crm/tasks/route.ts`, `[id]/route.ts`, `[id]/status/route.ts` | `task_created`, `task_completed`, `task_reopened` |
| `components/crm/opportunity-form.tsx` | direct insert: `stage_changed`, `estimated_value_changed` |
| `components/crm/opportunity-stage-change.tsx` | direct insert: `stage_changed` (**duplicate path**) |
| `components/crm/opportunity-note-form.tsx` | direct insert: `note_added` + `opportunity_notes` row |

**Gaps — no activity yet for:**

- Companies: create/update/deactivate/reactivate, payment terms
- Contacts: create/update/primary/deactivate/reactivate, portal invite/approve
- Quotes: `quote_sent`, `quote_accepted`, `quote_declined`, `quote_version_created`, `quote_deleted` (some stage sync logs `stage_changed` instead of quote-specific types)
- Opportunities: `opportunity_won`, `opportunity_lost` as distinct types (may appear only as `stage_changed`)
- Tasks: `task_updated`, `task_cancelled`
- Notes: `note_edited`, `note_pinned`, `note_unpinned`, `note_deleted`

### Existing UI

| Surface | Notes | Activity |
|---------|-------|----------|
| Opportunity detail (`app/admin/opportunities/[id]/page.tsx`) | Form + read-only list | Formatted list from `loadOpportunityDetail()` |
| Company 360° Activity tab (`components/crm/company-360-view.tsx`) | Merged from `opportunity_notes` | From `opportunity_activity` for company opportunity IDs only |
| Contact detail | Contact inline `notes` field only | None |
| Quote detail | Quote version notes fields only | None |
| Task detail/edit | None | None |
| Admin dashboard | None | None |
| Global search | Companies, contacts, opportunities, quotes, tasks | Notes not included |

**Company 360° limitations (`lib/crm/company-360.ts`):**

- `fetchCompanyActivity()` queries legacy opportunity tables only.
- No contact, company, portal, or standalone quote/task events.
- Filters: All, Opportunities, Quotes, Tasks, Notes — no Contacts or Portal.
- No date filter or pagination.

**`ActivityTimeline`** exists inside `company-360-view.tsx` but is not yet a shared component.

---

## Proposed shared schema

**File:** `docs/proposed-crm-notes-activity-migration.sql`

### `public.crm_notes`

Staff-authored notes linking to one or more CRM records.

| Column | Purpose |
|--------|---------|
| `body` | Note text |
| `company_id`, `contact_id`, `opportunity_id`, `quote_id`, `task_id` | Multi-link FKs; ≥1 required |
| `created_by` | Author (RESTRICT on delete) |
| `is_pinned` | Pin to top of lists |
| `deleted_at`, `deleted_by` | Soft delete |
| `source_opportunity_note_id` | Idempotent backfill key (drop later) |
| `created_at`, `updated_at` | Timestamps |

**Trigger:** `validate_crm_record_links()` — enforces relationship consistency and auto-derives `company_id`.

### `public.crm_activity`

Append-only system/staff event log.

| Column | Purpose |
|--------|---------|
| `activity_type`, `description`, `metadata` | Event payload |
| Same link FKs as notes | ≥1 required |
| `actor_profile_id` | Staff actor (**ON DELETE SET NULL**) |
| `source_opportunity_activity_id` | Idempotent backfill key (drop later) |
| `created_at` | Event time |

**Triggers:**

- Link validation on INSERT.
- `prevent_crm_activity_mutation()` — blocks UPDATE/DELETE unless admin.

### Indexes

Per entity link + `created_at DESC`, plus `activity_type`, pinned notes composite, and author index on notes.

---

## RLS plan

Reuses existing helpers: `is_approved_crm_admin()`, `is_approved_crm_staff()`, `can_access_opportunity()`.

**New helpers:**

| Function | Purpose |
|----------|---------|
| `can_access_crm_task(task_id)` | Mirrors existing tasks RLS (assignee, creator, or accessible opportunity) |
| `can_access_crm_links(...)` | OR across linked records — sales see company/contact/quote-level rows; opportunity/task require existing access rules |
| `can_edit_crm_note(...)` | Author + link access, or admin |
| `can_soft_delete_crm_note(...)` | Same as edit (soft delete via `deleted_at`) |

| Role | Notes | Activity |
|------|-------|----------|
| `super_admin` / `admin` | Full access; hard delete allowed | Full access including cleanup |
| `sales` | Read/create/update own or accessible notes; soft delete own | Read + INSERT only (append-only trigger + RLS) |
| `production` / `accounts` | No access | No access |
| `customer` | No access | No access |

**Notes visibility:** SELECT excludes `deleted_at IS NOT NULL` for sales.

**Metadata safety:** enforced in application helpers — never store secrets, tokens, email bodies, or auth data. Activity for `note_deleted` must not include note body in metadata.

**Does not weaken existing CRM policies** — opportunity/task access still flows through `can_access_opportunity()` / task rules.

---

## Backfill plan

**When:** After migration applied and app deployed to read/write shared tables (or immediately after migration if doing read-cutover first).

**File section:** bottom of `docs/proposed-crm-notes-activity-migration.sql` (commented SQL).

### `opportunity_notes` → `crm_notes`

1. Join each note to its opportunity for `company_id`.
2. Set `source_opportunity_note_id = opportunity_notes.id` for idempotency.
3. Map fields: `body`, `created_by`, `created_at`, `updated_at`; `is_pinned = false`.
4. Skip rows where `source_opportunity_note_id` already exists in `crm_notes`.

### `opportunity_activity` → `crm_activity`

1. Join each row to opportunity for `company_id`.
2. Set `source_opportunity_activity_id = opportunity_activity.id`.
3. Map `created_by` → `actor_profile_id`; preserve `activity_type`, `description`, `metadata`, `created_at`.
4. Skip rows where source ID already migrated.

### Transition strategy

| Phase | Read | Write |
|-------|------|-------|
| A — migration only | Legacy tables | Legacy tables (unchanged app) |
| B — backfill | Legacy + shared (prefer shared when present) | **Dual-write** to both |
| C — cutover | Shared only | Shared only (+ optional legacy mirror) |
| D — cleanup | Shared only | Shared only; drop legacy tables in future migration |

**Duplicate prevention during dual-write:** use server helpers only; do not double-insert `note_added` when writing to both tables for the same action.

**Do not drop** `opportunity_notes` or `opportunity_activity` until Phase D after verification.

---

## Server helpers (Phase 2)

Create `lib/crm/crm-notes-activity.ts` (or split into `crm-notes.ts` / `crm-activity.ts`):

```typescript
validateCrmLinks(supabase, links)     // server-side relationship checks
createCrmNote(supabase, input)        // insert note + note_added activity
updateCrmNote(supabase, id, input)    // edit body/pin + note_edited/pinned events
softDeleteCrmNote(supabase, id)       // deleted_at + note_deleted (no body in metadata)
createCrmActivity(supabase, input)    // single insert path; replaces logOpportunityActivity over time
getCrmTimeline(supabase, scope, opts) // paginated notes + activity for a context
```

**Requirements:**

- Accept validated IDs from server routes — never trust browser role or company data.
- Derive `company_id` when omitted.
- Use authenticated server Supabase client (RLS applies) or service role only where existing patterns require it.
- Replace scattered `opportunity_activity` inserts incrementally.

**API routes (suggested):**

- `POST /api/crm/notes` — create
- `PATCH /api/crm/notes/[id]` — edit body / pin
- `DELETE /api/crm/notes/[id]` — soft delete (admin hard delete optional)

Activity creation stays inside existing CRM mutation routes — not a public CRUD endpoint.

---

## Activity event catalogue

Extend `lib/crm/activity-types.ts` to `CRM_ACTIVITY_TYPES`:

### Companies

`company_created`, `company_updated`, `payment_terms_changed`, `company_deactivated`, `company_reactivated`

### Contacts

`contact_created`, `contact_updated`, `contact_set_primary`, `contact_deactivated`, `contact_reactivated`, `portal_invitation_sent`, `portal_invitation_resent`, `portal_access_approved`

### Opportunities

Existing plus: `opportunity_won`, `opportunity_lost` (or keep as `stage_changed` with metadata — pick one convention and avoid duplicates)

### Quotes

`quote_created`, `quote_version_created`, `quote_sent`, `quote_accepted`, `quote_declined`, `quote_linked`, `quote_deleted`

### Tasks

Existing plus: `task_updated`, `task_cancelled`

### Notes

`note_added`, `note_edited`, `note_pinned`, `note_unpinned`, `note_deleted`

**Deduplication rule:** one user action → one activity row. E.g. stage sync on quote accept should emit `quote_accepted` **or** `stage_changed`, not both unless descriptions differ meaningfully (prefer quote-specific type + optional stage in metadata).

---

## UI components (Phase 3)

| Component | Purpose |
|-----------|---------|
| `CrmNoteComposer` | Multiline body, pin toggle, prefilled links from page context |
| `CrmNotesList` | Pinned first, then newest; filters (All / Company / Contact / Opportunity / Quote / Task); edit/delete for authorised users; “Edited” label |
| `CrmActivityTimeline` | Reusable timeline extracted from Company 360°; icon, description, actor, timestamp, linked record, expandable metadata |

**Wire to pages:**

- Company 360° (Notes section + Activity tab)
- Contact detail (`app/admin/customers/[id]/page.tsx`)
- Opportunity detail (replace `OpportunityNoteForm`)
- Quote detail (`app/admin/quotes/[id]/page.tsx`)
- Task detail/edit pages

**Company 360° Activity tab enhancements:**

- Query `crm_activity` + `crm_notes` (not legacy tables after cutover)
- Include all related entity activity for the company
- Filters: All, Notes, Opportunities, Quotes, Tasks, Contacts, Portal
- Date filter: Today / 7 days / 30 days / All time
- Pagination or “Load more” (default page size ~25)

---

## Dashboard panel (Phase 5)

Add compact “Recent CRM activity” to admin dashboard (`components/admin/admin-dashboard-crm.tsx`):

- Latest 8–10 events from `getCrmTimeline` with staff-wide scope
- Description, actor, timestamp, link to primary record
- CRM staff only via `verifyApprovedCrmStaff()`

---

## Global search — Notes (Phase 6)

Extend `lib/crm/global-search-query.ts` and `app/api/admin/global-search/route.ts`:

- Only when query length ≥ 3
- Search `crm_notes.body` (exclude soft-deleted)
- Filter results to notes where user has link access (RLS on query handles this if using user client)
- Return: excerpt (truncated, no HTML), linked company/contact/opportunity label, route to note context page
- Do not expose to customers or non-CRM staff

Activity search: **out of scope initially**.

---

## Implementation phases

### Phase 0 — Review (current)

- [x] Schema audit
- [x] Proposed migration SQL
- [x] RLS plan
- [x] Backfill plan
- [ ] **Stakeholder review before apply**

### Phase 1 — Database

1. Apply `docs/proposed-crm-notes-activity-migration.sql` in staging.
2. Verify tables, indexes, triggers, policies.
3. Run backfill SQL manually.
4. Verify row counts match legacy tables.

### Phase 2 — Server foundation

1. Add `CRM_ACTIVITY_TYPES` and helpers.
2. Add note API routes with server-side validation.
3. Unit/integration tests for link validation and permissions.

### Phase 3 — Shared UI

1. Build `CrmNoteComposer`, `CrmNotesList`, `CrmActivityTimeline`.
2. Replace opportunity-only note form.
3. Add notes + activity to contact, quote, task pages.

### Phase 4 — Centralise activity logging

1. Replace `logOpportunityActivity()` calls with `createCrmActivity()`.
2. Remove direct client inserts from `opportunity-form.tsx`, `opportunity-stage-change.tsx`, `opportunity-note-form.tsx`.
3. Add missing event types (companies, contacts, quotes, portal).
4. Dual-write to legacy tables during transition if needed.

### Phase 5 — Company 360° + dashboard

1. Rewrite `fetchCompanyActivity()` → `getCrmTimeline({ companyId })`.
2. Add date filter, pagination, Contacts/Portal filters.
3. Add dashboard recent activity panel.

### Phase 6 — Global search + polish

1. Notes in global search (≥3 chars).
2. “Edited” / pin UI polish.
3. Performance review on indexed queries.

### Phase 7 — Deprecation (future)

1. Stop dual-write to legacy tables.
2. Switch all reads to shared tables.
3. New migration to drop `opportunity_notes`, `opportunity_activity`, and backfill key columns.

---

## Migration review checklist

Before applying SQL:

- [ ] Staging database backup taken
- [ ] Prerequisites applied (`opportunity_notes`, `opportunity_activity`, `contacts`, `contact_id` on opportunities/quotes)
- [ ] RLS behaviour reviewed for sales vs admin
- [ ] Backfill idempotency confirmed (`source_*` unique columns)
- [ ] Soft delete approach approved (`deleted_at` vs hard delete)
- [ ] Activity append-only triggers acceptable for non-admin staff
- [ ] Plan for dual-write period agreed
- [ ] No impact on quote calculations, stage rules, task assignment, portal permissions, PDF, or auth

After apply:

- [ ] `\d crm_notes` and `\d crm_activity` match expected columns
- [ ] Test insert note as sales on accessible opportunity
- [ ] Test insert note as sales on inaccessible opportunity (should fail)
- [ ] Test activity UPDATE as sales (should fail)
- [ ] Test activity UPDATE as admin (should succeed)
- [ ] Backfill counts: `opportunity_notes` = migrated notes, `opportunity_activity` = migrated activity

---

## Files to create/modify (application — after approval)

| Action | Path |
|--------|------|
| New | `lib/crm/crm-notes-activity.ts` |
| New | `lib/crm/activity-types.ts` (extend) |
| New | `components/crm/crm-note-composer.tsx` |
| New | `components/crm/crm-notes-list.tsx` |
| New | `components/crm/crm-activity-timeline.tsx` |
| New | `app/api/crm/notes/route.ts`, `[id]/route.ts` |
| Modify | `lib/crm/company-360.ts` |
| Modify | `components/crm/company-360-view.tsx` |
| Modify | `app/admin/opportunities/[id]/page.tsx` |
| Modify | `app/admin/customers/[id]/page.tsx` |
| Modify | `app/admin/quotes/[id]/page.tsx` |
| Modify | Task detail pages |
| Modify | `components/admin/admin-dashboard-crm.tsx` |
| Modify | `lib/crm/global-search-query.ts` |
| Deprecate | `components/crm/opportunity-note-form.tsx` |
| Refactor | `lib/crm/opportunity-stage-sync.ts` (`logOpportunityActivity` → shared helper) |

---

## Safety boundaries

**Do not modify:**

- Quote calculations and version totals
- Opportunity stage transition rules (only add activity logging alongside)
- Task assignment logic
- Portal customer permissions
- PDF generation
- Authentication and email body storage

**Do not run automatically:**

- Migration SQL
- Backfill SQL
- Git commit or push
