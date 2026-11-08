-- Rollback HIPS consolidation (Test only). Run only if no new dependencies were created.

BEGIN;

UPDATE public.material_supplier_products
SET material_id = 'e3d871c5-bc9f-4e50-9515-3cc528146a18',
    is_preferred = true,
    updated_at = now()
WHERE id = '00accca3-4de7-42dd-8755-7c7f0579a90b';

UPDATE public.materials
SET active = true, updated_at = now()
WHERE id = 'e3d871c5-bc9f-4e50-9515-3cc528146a18';

COMMIT;
