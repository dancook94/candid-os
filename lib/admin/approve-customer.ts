import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export type ApproveCustomerInput = {
  profileId: string;
  companyId: string;
};

export type ApproveCustomerResult =
  | { ok: true }
  | { ok: false; message: string; status: number };

/**
 * Approves a pending customer profile and links them to the selected company.
 *
 * Authorization must be enforced by the caller (verifyApprovedAdmin) before invoking.
 * Uses the authenticated admin session for the RPC so auth.uid() is available inside
 * approve_customer. Falls back to a service-role update if the RPC is unavailable.
 */
export async function approveCustomerProfile(
  supabase: SupabaseClient,
  input: ApproveCustomerInput
): Promise<ApproveCustomerResult> {
  const { error: rpcError } = await supabase.rpc("approve_customer", {
    profile_id: input.profileId,
    selected_company_id: input.companyId,
  });

  if (!rpcError) {
    return { ok: true };
  }

  const rpcMessage = rpcError.message ?? "Unable to approve customer.";

  if (!shouldFallbackFromRpc(rpcMessage)) {
    return { ok: false, message: rpcMessage, status: 400 };
  }

  return approveCustomerProfileDirect(input, rpcMessage);
}

function shouldFallbackFromRpc(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("only approved administrators can approve customers") ||
    normalized.includes("function public.approve_customer") ||
    normalized.includes("could not find the function")
  );
}

async function approveCustomerProfileDirect(
  input: ApproveCustomerInput,
  rpcMessage: string
): Promise<ApproveCustomerResult> {
  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Unable to initialise admin client.",
      status: 500,
    };
  }

  const { data: existingProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, user_role, account_status")
    .eq("id", input.profileId)
    .maybeSingle();

  if (profileError || !existingProfile) {
    return { ok: false, message: "Customer profile not found.", status: 404 };
  }

  if (existingProfile.user_role !== "customer") {
    return {
      ok: false,
      message: "Only customer profiles can be approved.",
      status: 400,
    };
  }

  if (existingProfile.account_status === "approved") {
    return { ok: false, message: "Customer is already approved.", status: 400 };
  }

  const { data: company, error: companyError } = await adminClient
    .from("companies")
    .select("id, is_active")
    .eq("id", input.companyId)
    .maybeSingle();

  if (companyError || !company) {
    return { ok: false, message: "Company not found.", status: 404 };
  }

  if (!company.is_active) {
    return { ok: false, message: "Company is not active.", status: 400 };
  }

  const { error: updateError } = await adminClient
    .from("profiles")
    .update({
      account_status: "approved",
      company_id: input.companyId,
    })
    .eq("id", input.profileId)
    .eq("user_role", "customer")
    .eq("account_status", "pending");

  if (updateError) {
    return {
      ok: false,
      message: updateError.message || rpcMessage,
      status: 400,
    };
  }

  return { ok: true };
}
