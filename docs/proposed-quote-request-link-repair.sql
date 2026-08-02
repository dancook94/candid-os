-- One-time repair: link existing sent quote Q-1 to its quote request.
-- Run manually in Supabase SQL editor after confirming IDs still match production.
--
-- Quote request: 0b854ddb-5ad4-4901-a097-b4efd71d2e61  (Summer Campaign Launch)
-- Quote:         12ebf8dc-417a-47aa-84f4-72e625d8fede  (Q-1, sent)
-- Shared opportunity: 53dac3ad-103f-40f3-864a-54afe26ef2da
-- Shared company:     244404d0-44fe-42ed-9ec2-6c2cb17c3c17

BEGIN;

UPDATE public.quotes
SET quote_request_id = '0b854ddb-5ad4-4901-a097-b4efd71d2e61'
WHERE id = '12ebf8dc-417a-47aa-84f4-72e625d8fede'
  AND quote_request_id IS NULL
  AND company_id = '244404d0-44fe-42ed-9ec2-6c2cb17c3c17'
  AND opportunity_id = '53dac3ad-103f-40f3-864a-54afe26ef2da';

UPDATE public.quote_requests
SET request_status = 'quoted'
WHERE id = '0b854ddb-5ad4-4901-a097-b4efd71d2e61'
  AND request_status = 'submitted';

COMMIT;
