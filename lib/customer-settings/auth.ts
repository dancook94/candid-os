import type { SupabaseClient, User } from "@supabase/supabase-js";

import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import { loadCustomerPortalProfile } from "@/lib/customer-shell-props";
import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerSettingsContext = {
  user: User;
  profile: {
    id: string;
    full_name: string | null;
    company_id: string;
    account_status: string;
    user_role: string;
    updated_at: string | null;
  };
  contact: {
    id: string;
    company_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    job_title: string | null;
    is_primary: boolean;
    is_active: boolean;
    updated_at: string;
  } | null;
  company: {
    id: string;
    company_name: string;
    trading_name: string | null;
    accounts_email: string | null;
    phone: string | null;
    vat_number: string | null;
    payment_terms_days: number | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
    website?: string | null;
    company_number?: string | null;
  };
  loginEmail: string;
};

function assertApprovedCustomer(
  profile: Awaited<ReturnType<typeof loadCustomerPortalProfile>>
): asserts profile is NonNullable<typeof profile> & {
  company_id: string;
  account_status: "approved";
  user_role: "customer";
} {
  if (!profile) {
    throw new CustomerSettingsError("Unable to verify your account.", 403);
  }

  if (profile.user_role !== "customer") {
    throw new CustomerSettingsError("Forbidden.", 403);
  }

  if (profile.account_status !== "approved") {
    throw new CustomerSettingsError(
      "Your account must be approved before you can manage settings.",
      403
    );
  }

  if (!profile.company_id) {
    throw new CustomerSettingsError(
      "Your account is not linked to a company.",
      403
    );
  }
}

export async function requireCustomerSettingsContext(
  supabase: SupabaseClient,
  user: User
): Promise<CustomerSettingsContext> {
  const profile = await loadCustomerPortalProfile(supabase, user.id);
  assertApprovedCustomer(profile);

  const adminClient = createAdminClient();

  const { data: company, error: companyError } = await adminClient
    .from("companies")
    .select(
      "id, company_name, trading_name, accounts_email, phone, vat_number, payment_terms_days, is_active, created_at, updated_at, website, company_number"
    )
    .eq("id", profile.company_id)
    .maybeSingle();

  if (companyError) {
    if (companyError.message.includes("column")) {
      const { data: fallbackCompany, error: fallbackError } = await adminClient
        .from("companies")
        .select(
          "id, company_name, trading_name, accounts_email, phone, vat_number, payment_terms_days, is_active, created_at, updated_at"
        )
        .eq("id", profile.company_id)
        .maybeSingle();

      if (fallbackError || !fallbackCompany) {
        throw new CustomerSettingsError(
          fallbackError?.message ?? "Company not found.",
          404
        );
      }

      return buildContext(user, profile, fallbackCompany, adminClient);
    }

    throw new CustomerSettingsError(companyError.message, 500);
  }

  if (!company) {
    throw new CustomerSettingsError("Company not found.", 404);
  }

  return buildContext(user, profile, company, adminClient);
}

async function buildContext(
  user: User,
  profile: NonNullable<Awaited<ReturnType<typeof loadCustomerPortalProfile>>> & {
    company_id: string;
  },
  company: CustomerSettingsContext["company"],
  adminClient: ReturnType<typeof createAdminClient>
): Promise<CustomerSettingsContext> {
  if (company.id !== profile.company_id) {
    throw new CustomerSettingsError("Forbidden.", 403);
  }

  const { data: contact } = await adminClient
    .from("contacts")
    .select(
      "id, company_id, full_name, email, phone, job_title, is_primary, is_active, updated_at"
    )
    .eq("profile_id", user.id)
    .eq("company_id", profile.company_id)
    .maybeSingle();

  if (contact && contact.company_id !== profile.company_id) {
    throw new CustomerSettingsError("Forbidden.", 403);
  }

  return {
    user,
    profile: {
      id: user.id,
      full_name: profile.full_name,
      company_id: profile.company_id,
      account_status: profile.account_status ?? "pending",
      user_role: profile.user_role ?? "customer",
      updated_at: profile.updated_at ?? null,
    },
    contact: contact ?? null,
    company,
    loginEmail: user.email ?? "",
  };
}

export function assertContactOwnership(
  context: CustomerSettingsContext,
  contactId: string
) {
  if (!context.contact || context.contact.id !== contactId) {
    throw new CustomerSettingsError(
      "You can only update your own contact record.",
      403
    );
  }
}

export function assertCompanyOwnership(
  context: CustomerSettingsContext,
  companyId: string
) {
  if (context.company.id !== companyId) {
    throw new CustomerSettingsError("Forbidden.", 403);
  }
}

export function assertConcurrency(
  storedUpdatedAt: string | null | undefined,
  expectedUpdatedAt: string | null | undefined
) {
  if (!expectedUpdatedAt || !storedUpdatedAt) {
    return;
  }

  if (new Date(storedUpdatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new CustomerSettingsError(
      "These details were updated elsewhere. Refresh and review before saving.",
      409
    );
  }
}
