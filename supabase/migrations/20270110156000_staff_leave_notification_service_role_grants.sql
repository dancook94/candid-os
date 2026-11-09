-- Staff leave notification processor: minimum service_role SELECT (Test/Live backend only).
-- RLS remains enabled; anon/authenticated grants are unchanged.

BEGIN;

COMMENT ON TABLE public.staff_leave_requests IS
  'Staff leave requests; service_role SELECT allows server-side notification rendering only.';

GRANT SELECT ON TABLE public.staff_leave_requests TO service_role;

-- Internal notification routing (sendNotification → loadNotificationSettings).
GRANT SELECT ON TABLE public.notification_settings TO service_role;

COMMIT;
