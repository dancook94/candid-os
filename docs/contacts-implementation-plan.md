# CRM Contacts — Implementation Plan

**Status:** Migration proposed, application **not yet implemented**.

Apply `docs/proposed-contacts-migration.sql` in Supabase (staging first), then implement the application changes below. Run `docs/proposed-contacts-backfill.sql` only after deploy and manual email export.

---

## Schema audit (current state)

### `public.companies`

Master B2B account. Staff already create companies without portal users (`CreateCompanyDialog`).

| Column | Notes |
|--------|-------|
| `company_name`, `trading_name` | Legal / trading names |
| `accounts_email`, `phone`, `vat_number` | Company-level details (not a person) |
| `payment_terms_days`, `is_active` | Commercial settings |
| `logo_*` | Portal branding |

**No person/contact layer today.**

### `public.profiles`

Auth-linked identity (`id` = `auth.users.id`). **This is what `/admin/customers` lists today** — not CRM contacts.

| Column | Notes |
|--------|-------|
| `full_name` | Display name |
| `company_id` | Nullable FK → companies |
| `requested_company_name` | Self-registration metadata |
| `account_status` | `pending` / `approved` / `disabled` |
| `user_role` | `customer` or staff roles |

**Email is not on `profiles`** — only in `auth.users` (loaded via admin API for staff/portal user lists).

### `public.customers`

**Does not exist.** No SQL or app references.

### `public.quote_requests`

Portal submissions. `requested_by` → `profiles.id` (authenticated portal user). Admin CRM does not require quote requests to create quotes.

### `public.quotes`

Admin quotes already insert with `company_id` only — no contact, no portal user required (`quote-builder-form.tsx`).

### `public.opportunities`

Requires `company_id` + staff owner. **No `contact_id` today** (added by proposed migration).

---

## Current customer / approval flow

| Path | Behaviour |
|------|-----------|
| **Self-registration** (`/register`) | Creates Auth user + profile; default `account_status = pending` (`default_registration_account_status` in app settings) |
| **Admin dashboard** | Lists pending profiles; `ApproveCustomer` RPC assigns company + approves |
| **Admin invite** (`POST /api/admin/invite-customer`) | Admin-only; browser sends name/email/company; creates Auth + profile as **approved** immediately; **no contact record** |
| **Pending customers** | Can sign in but stay on `/dashboard` with limited messaging until approved (`portal-access.ts`) |

**Core gap:** Staff workflow treats “customer” = “portal profile”. Pre-sales people (no Auth) cannot be recorded. Inviting always creates a new person rather than linking to an existing CRM contact.

**Important:** Opportunities and quotes **already work technically** without an approved portal user. The contacts table unlocks the **correct CRM workflow** (people → optional portal), not a missing FK.

---

## Proposed migration

**File:** `docs/proposed-contacts-migration.sql`

Creates:

- `public.contacts` with all requested fields including `invited_at`
- Unique `profile_id` when present
- Partial unique index: one active primary contact per company
- Partial unique index: normalised email per company (active contacts)
- `opportunities.contact_id` (nullable)
- `quotes.contact_id` (nullable)
- Validation triggers (company/contact consistency, single primary)
- RLS: admin full; sales read/insert/update; no customer access

**Also see:** `docs/proposed-contacts-backfill.sql` for existing portal user migration.

---

## Portal status derivation (application logic)

| Condition | Label |
|-----------|-------|
| `profile_id IS NULL` AND `invited_at IS NULL` | Not invited |
| `profile_id IS NULL` AND `invited_at IS NOT NULL` | Invitation sent |
| `profile_id` set AND profile `account_status = approved` | Approved |
| `profile_id` set AND profile `account_status = pending` | Pending approval |
| `profile_id` set AND profile `account_status = disabled` | Disabled |
| `is_active = false` | Inactive (separate column/badge) |

Implement in `lib/crm/contact-portal-status.ts`.

---

## Portal invite flow (post-migration)

**New route:** `POST /api/admin/contacts/[id]/invite`

Uses `verifyApprovedCrmStaff()` (or admin-only — confirm during review).

| Step | Action |
|------|--------|
| 1 | Load contact by ID (server-side, never trust client body for company/name/email) |
| 2 | Require `contact.email`, `contact.is_active`, `contact.profile_id IS NULL` |
| 3 | Load company; reject inactive company |
| 4 | Check auth for existing user by email |
| 5 | If auth user exists with customer profile on **different** company → 409, stop |
| 6 | `inviteUserByEmail` (or link existing auth user if appropriate) |
| 7 | Upsert `profiles`: `id`, `full_name` ← contact, `company_id` ← contact, `account_status = approved`, `user_role = customer` |
| 8 | `UPDATE contacts SET profile_id = user.id, invited_at = now()` |
| 9 | On failure after auth created: return error + document manual cleanup (do not create second contact) |

**Resend:** Same route when `profile_id IS NULL` and `invited_at IS NOT NULL` — resend invite, update `invited_at`.

**Deprecate:** Body-based `POST /api/admin/invite-customer` (or refactor to thin wrapper requiring `contactId`).

---

## Duplicate prevention

**On create/update contact (API + UI):**

- Normalise email server-side
- Query active contact with same `company_id` + normalised email
- If found and different ID → 409 with link to existing contact

**On invite:**

- Reject if `profile_id` already set
- Reject if email’s auth profile belongs to another company

---

## Implementation phases (after migration applied)

### Phase A — Foundation

| File | Action |
|------|--------|
| `lib/crm/types.ts` | Add `ContactRecord`; extend opportunity/quote types with `contact_id` |
| `lib/crm/contacts.ts` | List/detail loaders, duplicate check, normalise email |
| `lib/crm/contact-portal-status.ts` | Portal status enum + label/badge mapping |
| `lib/crm-schema.ts` | Optional: detect `contacts` table exists |
| `app/api/admin/contacts/route.ts` | `POST` create contact |
| `app/api/admin/contacts/[id]/route.ts` | `GET`, `PATCH` |
| `app/api/admin/contacts/[id]/set-primary/route.ts` | Set primary |
| `app/api/admin/contacts/[id]/deactivate/route.ts` | Soft deactivate / reactivate |
| `app/api/admin/contacts/[id]/invite/route.ts` | Contact-based portal invite |
| `components/crm/contact-form.tsx` | Reusable create/edit form |
| `components/crm/contact-portal-status-badge.tsx` | Status badge |
| `components/crm/contacts-table.tsx` | Shared table |

### Phase B — Customers admin (contacts list)

| File | Action |
|------|--------|
| `app/admin/customers/page.tsx` | **Replace** portal-profiles table with CRM contacts list, search/filters, “+ Add contact” |
| `app/admin/customers/new/page.tsx` | **Create** contact form |
| `app/admin/customers/[id]/page.tsx` | **Create** contact detail (opportunities, quotes, tasks, actions) |
| `app/admin/customers/[id]/edit/page.tsx` | **Create** edit page (or inline edit on detail) |
| `lib/crm/contacts-list.ts` | Search/filter query builder (name, email, company, portal status, active) |

**Page copy:** Rename eyebrow/title from “portal users” to “Contacts” (route stays `/admin/customers` per spec).

### Phase C — Company 360

| File | Action |
|------|--------|
| `lib/crm/company-360.ts` | Load contacts for company |
| `components/crm/company-360-view.tsx` | Replace “Portal users” tab/section with **Contacts** table; “+ Add contact” pre-fills company; portal status column |
| `app/admin/companies/[id]/page.tsx` | Pass contact data (via loader) |

Remove or demote free-text `InviteCustomerDialog` on company page in favour of per-contact “Invite to portal”.

### Phase D — Opportunities

| File | Action |
|------|--------|
| `components/crm/opportunity-form.tsx` | Optional contact select (active contacts for selected company) |
| `lib/crm/opportunity-form-values.ts` | Add `contactId` |
| `lib/crm/opportunities-list.ts` | Contact name column |
| `lib/crm/opportunity-detail.ts` | Load/display contact |
| `lib/crm/pipeline-board.ts` | Contact on pipeline cards (compact) |
| `app/admin/opportunities/[id]/page.tsx` | Show contact |

No requirement for `contact.profile_id` or portal approval.

### Phase E — Quotes

| File | Action |
|------|--------|
| `components/quote-builder-form.tsx` | Optional contact select; persist `contact_id` on insert/update |
| `app/admin/quotes/new/page.tsx` | Pre-fill contact from opportunity |
| `app/admin/quotes/[id]/page.tsx` | Show linked contact |
| `lib/admin-quotes-list.ts` | Contact column |

Carry `contact_id` from opportunity when creating quote — never duplicate contact row.

### Phase F — Cleanup & backfill

| File | Action |
|------|--------|
| `app/api/admin/invite-customer/route.ts` | Deprecate or require `contactId` |
| `components/invite-customer-dialog.tsx` | Remove or redirect to contact create + invite |
| `app/admin/page.tsx` | Pending approvals remain for self-registrations; optional link to contact once backfilled |
| `docs/proposed-contacts-backfill.sql` | Manual run in staging/production |

### Phase G — Access control

| File | Action |
|------|--------|
| `lib/crm-page-access.ts` | Extend guards for `/admin/customers/*` to CRM staff (sales + admin) |
| `lib/admin-page-access.ts` | Decide: contacts pages use CRM access vs admin-only |

**Recommendation:** Use `requireCrmPageAccess` for contact CRUD (sales can manage contacts). Keep admin-only for legacy invite until replaced.

---

## Files required (complete list)

### New documentation

- [x] `docs/proposed-contacts-migration.sql`
- [x] `docs/proposed-contacts-backfill.sql`
- [x] `docs/contacts-implementation-plan.md`

### New application files (after migration)

```
lib/crm/contacts.ts
lib/crm/contacts-list.ts
lib/crm/contact-portal-status.ts
app/api/admin/contacts/route.ts
app/api/admin/contacts/[id]/route.ts
app/api/admin/contacts/[id]/set-primary/route.ts
app/api/admin/contacts/[id]/deactivate/route.ts
app/api/admin/contacts/[id]/invite/route.ts
app/admin/customers/new/page.tsx
app/admin/customers/[id]/page.tsx
app/admin/customers/[id]/edit/page.tsx
components/crm/contact-form.tsx
components/crm/contact-portal-status-badge.tsx
components/crm/contacts-table.tsx
components/crm/company-contacts-section.tsx
components/crm/contact-detail-actions.tsx
```

### Modified application files (after migration)

```
lib/crm/types.ts
lib/crm/company-360.ts
lib/crm/opportunity-form-values.ts
lib/crm/opportunities-list.ts
lib/crm/opportunity-detail.ts
lib/crm/pipeline-board.ts
lib/crm-page-access.ts
components/crm/opportunity-form.tsx
components/crm/company-360-view.tsx
components/quote-builder-form.tsx
components/invite-customer-dialog.tsx
app/admin/customers/page.tsx
app/admin/companies/[id]/page.tsx
app/admin/opportunities/[id]/page.tsx
app/admin/quotes/new/page.tsx
app/admin/quotes/[id]/page.tsx
lib/admin-quotes-list.ts
app/api/admin/invite-customer/route.ts
```

---

## Security summary

| Role | contacts access |
|------|-----------------|
| super_admin / admin | Full (RLS + API) |
| sales | Read, create, update, invite (via API) |
| production / accounts | None |
| customer | None (no SELECT on contacts) |

All mutations validated server-side. Invite uses service role only after permission check. Do not weaken existing company, profile, opportunity, or quote RLS.

---

## Testing checklist (post-implementation)

- [ ] Create company → add contact (no email) → create opportunity → create quote (no portal user anywhere)
- [ ] Add contact with email → duplicate warning on same company
- [ ] Invite contact → profile created approved → `profile_id` linked → portal status “Approved”
- [ ] Resend invitation when `invited_at` set, `profile_id` null
- [ ] Self-registration still creates pending profile (unchanged)
- [ ] Backfill report has zero unresolved conflicts in staging
- [ ] Sales user can CRUD contacts; production user cannot
- [ ] Customer session cannot read `contacts` table

---

## Open decisions for review

1. **`ON DELETE CASCADE`** on `contacts.company_id` — deleting a company deletes all contacts. Confirm acceptable.
2. **Contacts page access** — CRM sales vs admin-only for `/admin/customers/*`.
3. **Invite sets `account_status = approved`** — matches current admin invite; self-registration stays pending.
4. **Rename nav label** “Customers” → “Contacts” while keeping URL `/admin/customers`.

---

## Next step

1. Review and apply `docs/proposed-contacts-migration.sql` in staging.
2. Confirm open decisions.
3. Implement Phase A → G in order.
4. Deploy, then run backfill manually.
