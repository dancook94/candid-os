# Candid OS CRM — Implementation Plan

This document tracks the phased CRM build replacing Capsule CRM. **Phase 1** adds the proposed migration, shared TypeScript helpers, and placeholder admin routes. Later phases add CRUD, pipeline UI, quote integration, and backfill execution.

---

## Phase 1 (current)

### Deliverables

| Item | Status |
|------|--------|
| `docs/proposed-crm-foundation-migration.sql` | Proposed — apply manually in Supabase |
| Shared CRM TypeScript types | Implemented |
| Stage / task config helpers | Implemented |
| Placeholder routes `/admin/opportunities`, `/admin/tasks` | Implemented |
| Admin sidebar links (super_admin / admin only) | Implemented |

### Before enabling CRM features

1. Review `docs/proposed-crm-foundation-migration.sql`
2. Apply in **staging** Supabase SQL editor
3. Verify RLS with admin and sales test users
4. Run backfill (Phase 2 script) before linking new quote flows

---

## Phase 2 — Backfill existing data

Create `docs/proposed-crm-backfill.sql` (not yet written). Goal: **one opportunity per sales journey**, never duplicate a quote request and its linked quote.

### A. Quote request with linked quote

```
quote_requests (1) ──► opportunities (1) ◄── quotes (0..1)
         │                      ▲
         └──── opportunity_id ──┘
                    ▲
         quotes.opportunity_id ─┘
```

**Steps:**

1. For each `quote_requests` row where `opportunity_id IS NULL` (oldest first):
   - Insert `opportunities` with:
     - `company_id`, `title = project_name`, `description`
     - `source = 'customer_portal'`
     - `stage` derived from linked quote status (see mapping below)
     - `owner_profile_id` = chosen default sales/admin profile
     - `created_by` = backfill actor profile
   - `UPDATE quote_requests SET opportunity_id = <new id>`

2. For each `quotes` row where `quote_request_id IS NOT NULL`:
   - `UPDATE quotes SET opportunity_id = quote_requests.opportunity_id`
   - **Do not** insert a second opportunity

### B. Standalone quote (no quote request)

For each `quotes` row where `quote_request_id IS NULL` AND `opportunity_id IS NULL`:

1. Insert one `opportunities` row (`source = 'admin'`, `title = project_name`, `company_id`)
2. Set `quotes.opportunity_id`

### Stage mapping (backfill)

| Condition | `opportunities.stage` |
|-----------|------------------------|
| No linked quote, `request_status IN ('submitted','reviewing')` | `new_enquiry` |
| Linked quote `status = 'draft'` | `quote_in_progress` |
| Linked quote `status = 'sent'` | `quote_sent` |
| Linked quote `status = 'accepted'` | `won` (+ `won_at`) |
| Linked quote `status = 'declined'` | `lost` (+ `lost_at`, generic reason) |
| Linked quote `status = 'expired'` | `follow_up` (manual review) |

### Verification queries

```sql
-- Must return 0 rows
SELECT qr.id
FROM quote_requests qr
JOIN quotes q ON q.quote_request_id = qr.id
WHERE qr.opportunity_id IS DISTINCT FROM q.opportunity_id;

-- Must return 0 rows
SELECT id FROM quote_requests
GROUP BY opportunity_id
HAVING opportunity_id IS NOT NULL AND COUNT(*) > 1;
```

---

## Phase 3 — Quote integration hooks

| File | Change |
|------|--------|
| `components/quote-request-form.tsx` | Create/link opportunity on customer submit |
| `components/quote-builder-form.tsx` | Require/propagate `opportunity_id`; stage sync |
| `lib/opportunity-stage-sync.ts` | Automatic stage transitions |
| `app/admin/quotes/new/page.tsx` | Opportunity selector |

Automatic transitions (application layer):

| Event | Stage |
|-------|-------|
| Opportunity created | `new_enquiry` |
| Quote draft linked | `quote_in_progress` |
| Quote sent | `quote_sent` |
| Quote accepted | `won` |
| Quote declined | `lost` |

Manual stage changes always allowed for CRM admin; logged to `opportunity_activity`.

---

## Phase 4 — Opportunities UI

| Route | Feature |
|-------|---------|
| `/admin/opportunities` | Pipeline board + list view |
| `/admin/opportunities/[id]` | Detail: overview, tasks, notes, activity, linked quote |

---

## Phase 5 — Tasks UI

| Route | Feature |
|-------|---------|
| `/admin/tasks` | My / Today / Overdue / Upcoming / Completed / Team |
| Embedded task forms | Opportunity, quote, company detail pages |

---

## Phase 6 — Sales role navigation

Extend `canAccessCrm()` routing so approved **sales** users see Opportunities and Tasks in the shell (RLS already prepared in migration).

---

## Application files (Phase 1)

| File | Purpose |
|------|---------|
| `lib/crm/types.ts` | Shared CRM record types |
| `lib/crm/opportunity-stages.ts` | Pipeline stage labels and ordering |
| `lib/crm/task-config.ts` | Task status/priority helpers |
| `lib/crm-schema.ts` | Detect whether migration has been applied |
| `lib/crm-page-access.ts` | Protected route guard (admin phase 1) |
| `lib/crm-auth.ts` | Server/API CRM role verification |
| `lib/staff-roles.ts` | `CRM_ROLES`, `isCrmRole()` |
| `components/crm-migration-placeholder.tsx` | Pre-migration UI message |
| `app/admin/opportunities/page.tsx` | Placeholder page |
| `app/admin/tasks/page.tsx` | Placeholder page |
| `components/app-shell.tsx` | CRM nav links |
| `lib/admin-shell-props.ts` | `showCrmNav` prop |

---

## Safety rules (all phases)

- Do not store quoted totals on `opportunities`
- Do not weaken customer or quote RLS
- Do not auto-run SQL from the application
- One opportunity per quote request / standalone quote journey
