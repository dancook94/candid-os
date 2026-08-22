-- Job proofing Phase 1: proofs, file links, manifest links, approval audit.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Safe to re-run after a partial failure (uses IF NOT EXISTS / DROP IF EXISTS).
-- Does NOT require 20260822110000_jobs_proof_required.sql — proof_required is
-- created here if missing.
--
-- Prerequisites:
--   supabase/migrations/20260802190000_jobs_foundation.sql
--   supabase/migrations/20260803200000_production_manifest_invoice_foundation.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Job-level proof requirement + workflow + bypass audit
-- ---------------------------------------------------------------------------

-- proof_required normally lives in 20260822110000; inline here so production
-- schemas that skipped that migration still succeed.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS proof_required boolean NOT NULL DEFAULT true;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS proof_workflow_status text,
  ADD COLUMN IF NOT EXISTS proof_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_approved_by_profile_id uuid,
  ADD COLUMN IF NOT EXISTS proof_bypass_reason text,
  ADD COLUMN IF NOT EXISTS proof_bypassed_by_profile_id uuid,
  ADD COLUMN IF NOT EXISTS proof_bypassed_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_proof_id uuid;

-- Backfill defaults for columns added without NOT NULL (safe on re-run).
UPDATE public.jobs
SET proof_workflow_status = 'no_proof'
WHERE proof_workflow_status IS NULL;

ALTER TABLE public.jobs
  ALTER COLUMN proof_workflow_status SET DEFAULT 'no_proof',
  ALTER COLUMN proof_workflow_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_proof_approved_by_profile_id_fkey'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_proof_approved_by_profile_id_fkey
      FOREIGN KEY (proof_approved_by_profile_id)
      REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_proof_bypassed_by_profile_id_fkey'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_proof_bypassed_by_profile_id_fkey
      FOREIGN KEY (proof_bypassed_by_profile_id)
      REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_proof_workflow_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_proof_workflow_status_check CHECK (
  proof_workflow_status IN (
    'not_required',
    'no_proof',
    'draft',
    'internal_review',
    'ready_to_send',
    'awaiting_customer',
    'changes_requested',
    'approved'
  )
);

COMMENT ON COLUMN public.jobs.proof_required IS
  'When true, customer proof approval gates Ready-to-Print.';
COMMENT ON COLUMN public.jobs.proof_workflow_status IS
  'Customer-facing proof workflow state for Ready-to-Print gating.';

-- ---------------------------------------------------------------------------
-- 2. Artwork file ↔ manifest item (many-to-many)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_file_manifest_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_file_id         uuid NOT NULL REFERENCES public.job_files(id) ON DELETE CASCADE,
  production_item_id  uuid NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  linked_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_file_manifest_items_unique_pair
    UNIQUE (job_file_id, production_item_id)
);

CREATE INDEX IF NOT EXISTS job_file_manifest_items_item_idx
  ON public.job_file_manifest_items (production_item_id);

-- ---------------------------------------------------------------------------
-- 3. Proofs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_proofs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                  uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  proof_reference         text NOT NULL,
  version_number          integer NOT NULL,
  status                  text NOT NULL DEFAULT 'draft',
  title                   text NOT NULL,
  artwork_origin          text NOT NULL DEFAULT 'customer_uploaded',
  customer_message        text,
  internal_note           text,
  created_by_profile_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_by_profile_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at                 timestamptz,
  viewed_at               timestamptz,
  approved_at             timestamptz,
  approved_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changes_requested_at    timestamptz,
  changes_requested_comment text,
  changes_requested_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  superseded_at           timestamptz,
  cancelled_at            timestamptz,
  internal_review_at      timestamptz,
  internal_review_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ready_to_send_at        timestamptz,
  ready_to_send_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_proofs_version_positive CHECK (version_number >= 1),
  CONSTRAINT job_proofs_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT job_proofs_status_check CHECK (
    status IN (
      'draft',
      'internal_review',
      'ready_to_send',
      'sent',
      'viewed',
      'changes_requested',
      'approved',
      'superseded',
      'cancelled'
    )
  ),
  CONSTRAINT job_proofs_artwork_origin_check CHECK (
    artwork_origin IN ('customer_uploaded', 'candid_created', 'existing_repeat')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS job_proofs_job_version_idx
  ON public.job_proofs (job_id, version_number);

CREATE INDEX IF NOT EXISTS job_proofs_job_status_idx
  ON public.job_proofs (job_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Proof files (Dropbox metadata only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_proof_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id            uuid NOT NULL REFERENCES public.job_proofs(id) ON DELETE CASCADE,
  job_file_id         uuid REFERENCES public.job_files(id) ON DELETE SET NULL,
  dropbox_file_id     text,
  dropbox_path        text,
  dropbox_revision    text,
  file_name           text NOT NULL,
  mime_type           text,
  file_size_bytes     bigint NOT NULL DEFAULT 0,
  content_hash        text,
  preview_dropbox_path text,
  preview_metadata    jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_proof_files_name_not_blank CHECK (btrim(file_name) <> '')
);

CREATE INDEX IF NOT EXISTS job_proof_files_proof_idx
  ON public.job_proof_files (proof_id);

-- ---------------------------------------------------------------------------
-- 5. Proof ↔ manifest items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_proof_manifest_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id            uuid NOT NULL REFERENCES public.job_proofs(id) ON DELETE CASCADE,
  production_item_id  uuid NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_proof_manifest_items_unique_pair
    UNIQUE (proof_id, production_item_id)
);

CREATE INDEX IF NOT EXISTS job_proof_manifest_items_item_idx
  ON public.job_proof_manifest_items (production_item_id);

-- ---------------------------------------------------------------------------
-- 6. Customer approval audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_proof_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id            uuid NOT NULL REFERENCES public.job_proofs(id) ON DELETE CASCADE,
  job_id              uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  customer_email      text NOT NULL,
  confirmation_text   text NOT NULL,
  ip_address          text,
  user_agent          text,
  proof_file_metadata jsonb,
  approved_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_proof_approvals_proof_idx
  ON public.job_proof_approvals (proof_id);

-- ---------------------------------------------------------------------------
-- 7. Internal review checklist (Phase 1 manual)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_proof_internal_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id            uuid NOT NULL REFERENCES public.job_proofs(id) ON DELETE CASCADE,
  checklist           jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_proof_internal_reviews_proof_idx
  ON public.job_proof_internal_reviews (proof_id, reviewed_at DESC);

-- ---------------------------------------------------------------------------
-- 8. Preflight metadata placeholder (Phase 2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_proof_preflight (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id            uuid NOT NULL REFERENCES public.job_proofs(id) ON DELETE CASCADE,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_proof_preflight_proof_idx
  ON public.job_proof_preflight (proof_id);

-- ---------------------------------------------------------------------------
-- 9. FK from jobs.current_proof_id (after job_proofs exists)
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_current_proof_fk;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_current_proof_fk
  FOREIGN KEY (current_proof_id) REFERENCES public.job_proofs(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 10. Data backfill (only after proof_required + proof_workflow_status exist)
-- ---------------------------------------------------------------------------

UPDATE public.jobs
SET proof_workflow_status = 'not_required'
WHERE proof_required = false
  AND proof_workflow_status = 'no_proof';

-- ---------------------------------------------------------------------------
-- 11. RLS (tables must exist first; enable is safe to re-run)
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_proof_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_proof_manifest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_proof_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_file_manifest_items ENABLE ROW LEVEL SECURITY;

COMMIT;
