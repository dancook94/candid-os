import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

import { normalizeContactEmail } from "@/lib/crm/contacts";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { assertCustomerPortalInviteAllowed } from "@/lib/communications/auth-guards";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteContactResult =
  | { ok: true; message: string; profileId: string }
  | { ok: false; status: number; message: string };

type AdminClient = ReturnType<typeof createAdminClient>;

async function findAuthUserByEmail(adminClient: AdminClient, email: string) {
  const { data, error } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    return { user: null as User | null, error: error.message };
  }

  const user =
    data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.toLowerCase()
    ) ?? null;

  return { user, error: null };
}

export async function inviteContactToPortal(
  supabase: SupabaseClient,
  contactId: string,
  redirectTo: string
): Promise<InviteContactResult> {
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();

  let adminClient: AdminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message:
        error instanceof Error
          ? error.message
          : "Unable to initialise admin client.",
    };
  }

  const { data: contact, error: contactError } = await adminClient
    .from("contacts")
    .select(
      "id, company_id, full_name, email, profile_id, is_active, invited_at"
    )
    .eq("id", contactId)
    .maybeSingle();

  if (contactError || !contact) {
    return {
      ok: false,
      status: 404,
      message: contactError?.message ?? "Contact not found.",
    };
  }

  if (!contact.is_active) {
    return {
      ok: false,
      status: 400,
      message: "Inactive contacts cannot be invited to the portal.",
    };
  }

  const email = normalizeContactEmail(contact.email);

  if (!email) {
    return {
      ok: false,
      status: 400,
      message: "Contact must have an email address before inviting to the portal.",
    };
  }

  const inviteGuard = assertCustomerPortalInviteAllowed(email);

  if (!inviteGuard.ok) {
    return {
      ok: false,
      status: 403,
      message: inviteGuard.message,
    };
  }

  const { data: company, error: companyError } = await adminClient
    .from("companies")
    .select("id, company_name, is_active")
    .eq("id", contact.company_id)
    .maybeSingle();

  if (companyError || !company) {
    return {
      ok: false,
      status: 400,
      message: companyError?.message ?? "Company not found.",
    };
  }

  if (!company.is_active) {
    return {
      ok: false,
      status: 400,
      message: "Company is not active.",
    };
  }

  if (contact.profile_id) {
    const { data: linkedProfile } = await adminClient
      .from("profiles")
      .select("account_status, user_role, company_id")
      .eq("id", contact.profile_id)
      .maybeSingle();

    if (linkedProfile?.account_status === "approved") {
      return {
        ok: false,
        status: 409,
        message: "This contact already has approved portal access.",
      };
    }

    if (linkedProfile?.account_status === "pending") {
      const { error: resendError } =
        await adminClient.auth.admin.inviteUserByEmail(email, {
          data: {
            full_name: contact.full_name,
            company_name: company.company_name,
          },
          redirectTo,
        });

      if (resendError) {
        return {
          ok: false,
          status: 400,
          message: resendError.message,
        };
      }

      const now = new Date().toISOString();

      await adminClient
        .from("contacts")
        .update({ invited_at: now, updated_at: now })
        .eq("id", contact.id);

      if (actor) {
        await createCrmActivity(supabase, {
          companyId: contact.company_id,
          contactId: contact.id,
          activityType: CRM_ACTIVITY_TYPES.portalInvitationResent,
          description: `${contact.full_name} was re-invited to the portal.`,
          metadata: { contact_id: contact.id },
          actorProfileId: actor.id,
        });
      }

      return {
        ok: true,
        message: `Invitation resent to ${email}.`,
        profileId: contact.profile_id,
      };
    }

    return {
      ok: false,
      status: 409,
      message: "This contact is linked to a portal user that cannot be re-invited.",
    };
  }

  let authUser: User | null = null;

  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: contact.full_name,
        company_name: company.company_name,
      },
      redirectTo,
    });

  if (inviteError) {
    const { user: existingUser, error: lookupError } =
      await findAuthUserByEmail(adminClient, email);

    if (lookupError || !existingUser) {
      return {
        ok: false,
        status: 400,
        message: inviteError.message,
      };
    }

    authUser = existingUser;
  } else {
    authUser = inviteData.user;
  }

  if (!authUser) {
    return {
      ok: false,
      status: 400,
      message: "Unable to resolve portal user for invitation.",
    };
  }

  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id, user_role, company_id, account_status")
    .eq("id", authUser.id)
    .maybeSingle();

  if (existingProfile) {
    if (existingProfile.user_role !== "customer") {
      return {
        ok: false,
        status: 409,
        message: "This email belongs to a staff account and cannot be linked.",
      };
    }

    if (
      existingProfile.company_id &&
      existingProfile.company_id !== contact.company_id
    ) {
      return {
        ok: false,
        status: 409,
        message:
          "This email is already linked to a customer profile at another company.",
      };
    }

    const { data: linkedContact } = await adminClient
      .from("contacts")
      .select("id")
      .eq("profile_id", authUser.id)
      .neq("id", contact.id)
      .maybeSingle();

    if (linkedContact) {
      return {
        ok: false,
        status: 409,
        message: "This portal user is already linked to another contact.",
      };
    }
  }

  const now = new Date().toISOString();

  const { error: profileError } = await adminClient.from("profiles").upsert(
    {
      id: authUser.id,
      full_name: contact.full_name,
      company_id: company.id,
      requested_company_name: company.company_name,
      account_status: "approved",
      user_role: "customer",
    },
    { onConflict: "id" }
  );

  if (profileError) {
    return {
      ok: false,
      status: 400,
      message: profileError.message,
    };
  }

  const { error: contactUpdateError } = await adminClient
    .from("contacts")
    .update({
      profile_id: authUser.id,
      invited_at: now,
      updated_at: now,
    })
    .eq("id", contact.id)
    .is("profile_id", null);

  if (contactUpdateError) {
    return {
      ok: false,
      status: 400,
      message: contactUpdateError.message,
    };
  }

  if (actor) {
    await createCrmActivity(supabase, {
      companyId: contact.company_id,
      contactId: contact.id,
      activityType: CRM_ACTIVITY_TYPES.portalInvitationSent,
      description: `${contact.full_name} was invited to the portal.`,
      metadata: { contact_id: contact.id },
      actorProfileId: actor.id,
    });
  }

  return {
    ok: true,
    message: `Invitation sent to ${email}.`,
    profileId: authUser.id,
  };
}
