import type { PortalProfile } from "@/lib/portal-access";
import { isCustomerRole } from "@/lib/portal-access";

/** Pending customers land here after email confirmation or login. */
export const CUSTOMER_AWAITING_APPROVAL_PATH = "/register/confirmed";

export function isPendingCustomer(profile: PortalProfile | null | undefined) {
  return (
    Boolean(profile) &&
    isCustomerRole(profile!.user_role) &&
    profile!.account_status === "pending"
  );
}

export function resolvePendingCustomerRedirect(
  profile: PortalProfile | null | undefined
) {
  if (isPendingCustomer(profile)) {
    return CUSTOMER_AWAITING_APPROVAL_PATH;
  }

  return null;
}
