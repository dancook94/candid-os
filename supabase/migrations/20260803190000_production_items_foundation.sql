-- Production items foundation: internal workshop tracking per job.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260802190000_jobs_foundation.sql
--
-- Architecture:
--   public.jobs → public.production_items → future public.printfactory_jobs

BEGIN;

CREATE TABLE IF NOT EXISTS public.production_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  item_reference            text,
  item_name                 text NOT NULL,
  description               text,
  quantity                  numeric,
  production_status         text NOT NULL DEFAULT 'artwork',
  priority                  text NOT NULL DEFAULT 'normal',
  required_at               timestamptz,
  assigned_to_profile_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  machine                   text,
  material                  text,
  media_profile             text,
  width_mm                  numeric,
  height_mm                 numeric,
  copies                    integer,
  sides                     text,
  finishing_notes           text,
  customer_safe_status      text NOT NULL DEFAULT 'artwork_being_prepared',
  synology_source_path      text,
  printfactory_match_status text NOT NULL DEFAULT 'unmatched',
  printfactory_job_guid     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz,
  deleted_at                timestamptz,

  CONSTRAINT production_items_item_name_not_blank CHECK (btrim(item_name) <> ''),
  CONSTRAINT production_items_production_status_check CHECK (
    production_status IN (
      'artwork',
      'ready_for_production',
      'printing',
      'cutting',
      'laminating',
      'finishing',
      'quality_check',
      'packing',
      'ready_for_dispatch',
      'completed',
      'on_hold'
    )
  ),
  CONSTRAINT production_items_priority_check CHECK (
    priority IN ('low', 'normal', 'high', 'urgent')
  ),
  CONSTRAINT production_items_customer_safe_status_check CHECK (
    customer_safe_status IN (
      'artwork_being_prepared',
      'in_production',
      'preparing_for_dispatch',
      'completed',
      'on_hold'
    )
  ),
  CONSTRAINT production_items_printfactory_match_status_check CHECK (
    printfactory_match_status IN (
      'unmatched',
      'suggested',
      'matched_automatically',
      'matched_manually',
      'ignored'
    )
  ),
  CONSTRAINT production_items_sides_check CHECK (
    sides IS NULL OR sides IN ('single', 'double')
  ),
  CONSTRAINT production_items_completed_consistency CHECK (
    (production_status = 'completed' AND completed_at IS NOT NULL)
    OR (production_status <> 'completed')
    OR completed_at IS NULL
  )
);

COMMENT ON TABLE public.production_items IS
  'Individual production pieces or groups within a job. Internal workshop use only.';
COMMENT ON COLUMN public.production_items.customer_safe_status IS
  'Customer-facing summary derived from production_status. Not exposed directly to customers in Phase 1.';
COMMENT ON COLUMN public.production_items.synology_source_path IS
  'Future PrintFactory match key: Synology path containing the Candid job reference.';
COMMENT ON COLUMN public.production_items.printfactory_job_guid IS
  'Future link to PrintFactory job record once sync is enabled.';

CREATE INDEX IF NOT EXISTS production_items_job_id_idx
  ON public.production_items (job_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS production_items_company_id_idx
  ON public.production_items (company_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS production_items_status_idx
  ON public.production_items (production_status, required_at ASC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS production_items_assigned_idx
  ON public.production_items (assigned_to_profile_id, production_status)
  WHERE deleted_at IS NULL AND assigned_to_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS production_items_required_at_idx
  ON public.production_items (required_at ASC NULLS LAST)
  WHERE deleted_at IS NULL AND production_status <> 'completed';

CREATE INDEX IF NOT EXISTS production_items_printfactory_match_idx
  ON public.production_items (printfactory_match_status)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.production_items_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_items_updated_at ON public.production_items;

CREATE TRIGGER production_items_updated_at
  BEFORE UPDATE ON public.production_items
  FOR EACH ROW
  EXECUTE FUNCTION public.production_items_set_updated_at();

ALTER TABLE public.production_items ENABLE ROW LEVEL SECURITY;

-- RLS policies to be applied separately once staff role matrix is finalised.
-- Application code uses service role with server-side authorization checks.

COMMIT;
