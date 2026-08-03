-- PrintFactory unified mapping rules foundation.
-- Apply manually in Supabase. DO NOT run automatically.
--
-- Consolidates stored path/text mapping patterns used by PrintFactory matching.
-- Existing code still reads legacy tables; this table is required for schema readiness.

BEGIN;

CREATE TABLE IF NOT EXISTS public.printfactory_mapping_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type             text NOT NULL,
  match_value           text NOT NULL,
  candid_job_id         uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  production_item_id    uuid REFERENCES public.production_items(id) ON DELETE CASCADE,
  confidence            numeric,
  is_active             boolean NOT NULL DEFAULT true,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT printfactory_mapping_rules_rule_type_check CHECK (
    rule_type IN (
      'path_prefix',
      'job_name_pattern',
      'filename_pattern',
      'item_reference'
    )
  ),
  CONSTRAINT printfactory_mapping_rules_match_value_not_blank
    CHECK (btrim(match_value) <> ''),
  CONSTRAINT printfactory_mapping_rules_target_check CHECK (
    candid_job_id IS NOT NULL OR production_item_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS printfactory_mapping_rules_active_unique_idx
  ON public.printfactory_mapping_rules (rule_type, match_value)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS printfactory_mapping_rules_candid_job_idx
  ON public.printfactory_mapping_rules (candid_job_id)
  WHERE candid_job_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS printfactory_mapping_rules_production_item_idx
  ON public.printfactory_mapping_rules (production_item_id)
  WHERE production_item_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS printfactory_mapping_rules_active_type_idx
  ON public.printfactory_mapping_rules (rule_type, is_active)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.printfactory_mapping_rules IS
  'Reusable PrintFactory matching rules confirmed by CRM staff (path, filename, job-name, item-reference patterns).';

COMMENT ON COLUMN public.printfactory_mapping_rules.rule_type IS
  'path_prefix | job_name_pattern | filename_pattern | item_reference';

COMMENT ON COLUMN public.printfactory_mapping_rules.match_value IS
  'Synology path prefix, filename substring, job-name substring, or exact item reference.';

CREATE OR REPLACE FUNCTION public.printfactory_mapping_rules_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS printfactory_mapping_rules_updated_at
  ON public.printfactory_mapping_rules;

CREATE TRIGGER printfactory_mapping_rules_updated_at
  BEFORE UPDATE ON public.printfactory_mapping_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.printfactory_mapping_rules_set_updated_at();

ALTER TABLE public.printfactory_mapping_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS printfactory_mapping_rules_select_crm
  ON public.printfactory_mapping_rules;

CREATE POLICY printfactory_mapping_rules_select_crm
  ON public.printfactory_mapping_rules
  FOR SELECT
  TO authenticated
  USING (public.is_approved_crm_staff());

DROP POLICY IF EXISTS printfactory_mapping_rules_insert_crm
  ON public.printfactory_mapping_rules;

CREATE POLICY printfactory_mapping_rules_insert_crm
  ON public.printfactory_mapping_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_approved_crm_staff());

DROP POLICY IF EXISTS printfactory_mapping_rules_update_crm
  ON public.printfactory_mapping_rules;

CREATE POLICY printfactory_mapping_rules_update_crm
  ON public.printfactory_mapping_rules
  FOR UPDATE
  TO authenticated
  USING (public.is_approved_crm_staff())
  WITH CHECK (public.is_approved_crm_staff());

DROP POLICY IF EXISTS printfactory_mapping_rules_delete_crm
  ON public.printfactory_mapping_rules;

CREATE POLICY printfactory_mapping_rules_delete_crm
  ON public.printfactory_mapping_rules
  FOR DELETE
  TO authenticated
  USING (public.is_approved_crm_staff());

COMMIT;
