import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ADMIN_PAGE_PROFILE_SELECT } from "@/lib/admin-page-access";
import { buildLoginUrl } from "@/lib/auth-redirect";
import {
  resolveApprovedRoleHomePath,
  type PortalProfile,
} from "@/lib/portal-access";
import { isAdminRole } from "@/lib/staff-roles";

export const PURCHASING_DASHBOARD_PATH = "/purchasing";
export const PURCHASING_NEW_PATH = "/purchasing/new";

const PURCHASE_ORDER_ID_PATH =
  /^\/purchasing\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/issue)?$/i;

export function purchaseOrderDetailPath(orderId: string) {
  return `/purchasing/${orderId}`;
}

export function purchaseOrderIssuePath(orderId: string) {
  return `/purchasing/${orderId}/issue`;
}

function purchasingReturnPath(nextPath: string) {
  if (
    nextPath === PURCHASING_DASHBOARD_PATH ||
    nextPath === PURCHASING_NEW_PATH ||
    PURCHASE_ORDER_ID_PATH.test(nextPath)
  ) {
    return nextPath;
  }

  return PURCHASING_DASHBOARD_PATH;
}

export const PURCHASING_PROFILE_SELECT = ADMIN_PAGE_PROFILE_SELECT;

export type PurchasingProfile = PortalProfile & {
  full_name: string | null;
  avatar_storage_path: string | null;
};

export type PurchasingPageDecision = "allow" | "login" | string;

export function resolvePurchasingPageAccess(input: {
  hasUser: boolean;
  profile: PortalProfile | null;
  profileError: boolean;
  canIssuePurchaseOrders: boolean;
}): PurchasingPageDecision {
  if (!input.hasUser || input.profileError || !input.profile) {
    return "login";
  }

  const homePath = resolveApprovedRoleHomePath(input.profile);

  if (input.profile.account_status !== "approved") {
    return homePath;
  }

  const roleCanPurchase =
    isAdminRole(input.profile.user_role) ||
    input.profile.user_role === "production";

  if (!roleCanPurchase || !input.canIssuePurchaseOrders) {
    return homePath;
  }

  return "allow";
}

export async function loadCanIssuePurchaseOrders(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("can_issue_purchase_orders");

  return !error && data === true;
}

export async function requirePurchasingPageAccess(
  supabase: SupabaseClient,
  nextPath: string = PURCHASING_DASHBOARD_PATH
): Promise<PurchasingProfile> {
  const loginPath = purchasingReturnPath(nextPath);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(loginPath));
  }

  const [profileResult, canIssuePurchaseOrders] = await Promise.all([
    supabase
      .from("profiles")
      .select(PURCHASING_PROFILE_SELECT)
      .eq("id", user.id)
      .single(),
    loadCanIssuePurchaseOrders(supabase),
  ]);

  const profile = profileResult.data as PurchasingProfile | null;
  const decision = resolvePurchasingPageAccess({
    hasUser: true,
    profile,
    profileError: Boolean(profileResult.error) || !profile,
    canIssuePurchaseOrders,
  });

  if (decision === "login") {
    redirect(buildLoginUrl(loginPath));
  }

  if (decision !== "allow") {
    redirect(decision);
  }

  return profile as PurchasingProfile;
}
