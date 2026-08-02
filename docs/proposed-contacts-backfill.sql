-- Proposed backfill: create contacts for existing customer portal profiles
-- Review and apply manually in Supabase AFTER proposed-contacts-migration.sql
-- and AFTER the contacts application layer is deployed.
--
-- DO NOT run automatically. Run in staging first. Requires service-role access
-- to read auth.users emails (via Supabase SQL editor / admin context).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Staging table for manual review of ambiguous rows
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contacts_backfill_report (
  id              bigserial PRIMARY KEY,
  profile_id      uuid,
  contact_id      uuid,
  company_id      uuid,
  email           text,
  full_name       text,
  outcome         text NOT NULL,
  details         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contacts_backfill_report IS
  'Manual backfill audit log. Drop after review if desired.';

-- ---------------------------------------------------------------------------
-- 2. Backfill function (run once with a known staff actor UUID)
-- ---------------------------------------------------------------------------
-- Replace :backfill_actor_id with an approved admin profile UUID before running.
--
-- Example:
--   SELECT public.backfill_contacts_from_customer_profiles(
--     '00000000-0000-0000-0000-000000000001'::uuid
--   );

CREATE OR REPLACE FUNCTION public.backfill_contacts_from_customer_profiles(
  backfill_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  normalised_email text;
  existing_contact_id uuid;
  existing_profile_id uuid;
  new_contact_id uuid;
BEGIN
  IF NOT public.is_assignable_crm_staff(backfill_actor_id) THEN
    RAISE EXCEPTION 'backfill_actor_id must be approved CRM staff';
  END IF;

  FOR rec IN
    SELECT
      p.id AS profile_id,
      p.full_name,
      p.company_id,
      p.account_status,
      p.user_role
    FROM public.profiles p
    WHERE p.user_role = 'customer'
      AND p.company_id IS NOT NULL
    ORDER BY p.created_at ASC
  LOOP
    -- Skip if already linked
    SELECT c.id INTO existing_contact_id
    FROM public.contacts c
    WHERE c.profile_id = rec.profile_id
    LIMIT 1;

    IF existing_contact_id IS NOT NULL THEN
      INSERT INTO public.contacts_backfill_report (
        profile_id, contact_id, company_id, full_name, outcome, details
      ) VALUES (
        rec.profile_id, existing_contact_id, rec.company_id, rec.full_name,
        'skipped_already_linked', NULL
      );
      CONTINUE;
    END IF;

    -- Email is not stored on profiles; must be supplied externally.
    -- This function expects a companion temp table populated via service role:
    --   CREATE TEMP TABLE profile_auth_emails (profile_id uuid PRIMARY KEY, email text);
    IF to_regclass('pg_temp.profile_auth_emails') IS NULL THEN
      RAISE EXCEPTION
        'Create temp table profile_auth_emails (profile_id, email) before running backfill';
    END IF;

    SELECT lower(btrim(pae.email))
    INTO normalised_email
    FROM pg_temp.profile_auth_emails pae
    WHERE pae.profile_id = rec.profile_id;

    IF normalised_email IS NULL OR normalised_email = '' THEN
      INSERT INTO public.contacts_backfill_report (
        profile_id, company_id, full_name, outcome, details
      ) VALUES (
        rec.profile_id, rec.company_id, rec.full_name,
        'ambiguous_no_email',
        'Profile has company but auth email could not be resolved. Create contact manually.'
      );
      CONTINUE;
    END IF;

    -- Match existing contact by email within company
    SELECT c.id, c.profile_id
    INTO existing_contact_id, existing_profile_id
    FROM public.contacts c
    WHERE c.company_id = rec.company_id
      AND lower(btrim(c.email)) = normalised_email
    LIMIT 1;

    IF existing_contact_id IS NOT NULL THEN
      IF existing_profile_id IS NULL THEN
        UPDATE public.contacts
        SET profile_id = rec.profile_id,
            updated_at = now()
        WHERE id = existing_contact_id;

        INSERT INTO public.contacts_backfill_report (
          profile_id, contact_id, company_id, email, full_name, outcome, details
        ) VALUES (
          rec.profile_id, existing_contact_id, rec.company_id, normalised_email,
          rec.full_name, 'linked_existing_contact_by_email', NULL
        );
      ELSIF existing_profile_id = rec.profile_id THEN
        INSERT INTO public.contacts_backfill_report (
          profile_id, contact_id, company_id, email, full_name, outcome, details
        ) VALUES (
          rec.profile_id, existing_contact_id, rec.company_id, normalised_email,
          rec.full_name, 'skipped_already_linked_by_email', NULL
        );
      ELSE
        INSERT INTO public.contacts_backfill_report (
          profile_id, contact_id, company_id, email, full_name, outcome, details
        ) VALUES (
          rec.profile_id, existing_contact_id, rec.company_id, normalised_email,
          rec.full_name, 'conflict_contact_linked_to_other_profile',
          format('Contact %s already linked to profile %s', existing_contact_id, existing_profile_id)
        );
      END IF;

      CONTINUE;
    END IF;

    -- Check email not used by contact on another company
    IF EXISTS (
      SELECT 1
      FROM public.contacts c
      WHERE lower(btrim(c.email)) = normalised_email
        AND c.company_id IS DISTINCT FROM rec.company_id
    ) THEN
      INSERT INTO public.contacts_backfill_report (
        profile_id, company_id, email, full_name, outcome, details
      ) VALUES (
        rec.profile_id, rec.company_id, normalised_email, rec.full_name,
        'conflict_email_on_other_company',
        'Same email exists on a contact at a different company. Manual review required.'
      );
      CONTINUE;
    END IF;

    INSERT INTO public.contacts (
      company_id,
      full_name,
      email,
      profile_id,
      is_primary,
      is_active,
      created_by
    ) VALUES (
      rec.company_id,
      COALESCE(NULLIF(btrim(rec.full_name), ''), 'Unnamed contact'),
      normalised_email,
      rec.profile_id,
      false,
      true,
      backfill_actor_id
    )
    RETURNING id INTO new_contact_id;

    INSERT INTO public.contacts_backfill_report (
      profile_id, contact_id, company_id, email, full_name, outcome, details
    ) VALUES (
      rec.profile_id, new_contact_id, rec.company_id, normalised_email,
      rec.full_name, 'created_contact', NULL
    );
  END LOOP;
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Backfill procedure (manual, outside transaction)
-- ---------------------------------------------------------------------------
--
-- 1. Apply proposed-contacts-migration.sql in staging.
-- 2. Export auth emails for customer profiles (service role script or Supabase dashboard):
--
--    -- Pseudocode (run from app script with service role, not pure SQL):
--    -- For each profile where user_role = 'customer':
--    --   auth.admin.getUserById(profile.id) → email
--    --   INSERT INTO profile_auth_emails VALUES (profile.id, email)
--
-- 3. In SQL editor session:
--    CREATE TEMP TABLE profile_auth_emails (
--      profile_id uuid PRIMARY KEY,
--      email text NOT NULL
--    );
--    -- paste INSERT rows from step 2
--
-- 4. SELECT public.backfill_contacts_from_customer_profiles('<admin-profile-uuid>');
--
-- 5. Review:
--    SELECT outcome, COUNT(*) FROM public.contacts_backfill_report GROUP BY outcome;
--    SELECT * FROM public.contacts_backfill_report WHERE outcome LIKE 'conflict%' OR outcome LIKE 'ambiguous%';
--
-- 6. Resolve conflicts manually before production run.
--
-- Rules enforced:
--   - customer profiles only (user_role = 'customer')
--   - one contact per profile (profile_id unique on contacts)
--   - uses profile.company_id
--   - no duplicate email within same company (links instead of insert)
--   - staff profiles never processed
--   - ambiguous cases logged, not guessed
