import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { buildInvitePasswordSetupRedirect } from "@/lib/auth-invite-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStaffRole } from "@/lib/staff-roles";

export type StaffAuthState = {
  invited_at: string | null;
  email_confirmed_at: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
};

export type StaffAuthActionType = "resend_invite" | "send_password_setup";

export type StaffAuthActionResult =
  | { ok: true; message: string }
  | { ok: false; status: number; message: string };

type AdminClient = ReturnType<typeof createAdminClient>;

type StaffProfileRow = {
  id: string;
  full_name: string | null;
  user_role: string;
  account_status: string;
};

export function mapStaffAuthState(user: User): StaffAuthState {
  return {
    invited_at: user.invited_at ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    confirmed_at: user.confirmed_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
  };
}

export function canResendStaffInvite(auth: StaffAuthState): boolean {
  return Boolean(auth.invited_at && !auth.email_confirmed_at && !auth.confirmed_at);
}

export function canSendStaffPasswordSetup(auth: StaffAuthState): boolean {
  return Boolean(auth.email_confirmed_at || auth.confirmed_at);
}

export function resolveStaffAuthActionType(
  auth: StaffAuthState
): StaffAuthActionType | null {
  if (canSendStaffPasswordSetup(auth)) {
    return "send_password_setup";
  }

  if (canResendStaffInvite(auth)) {
    return "resend_invite";
  }

  return null;
}

export function mapStaffAuthActionError(error: {
  message?: string;
  status?: number;
  code?: string;
} | null | undefined): { message: string; status: number } {
  const message = (error?.message ?? "").toLowerCase();
  const status = error?.status;

  if (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("email rate limit")
  ) {
    return {
      message: "Too many requests. Wait a moment and try again.",
      status: 429,
    };
  }

  if (message.includes("already been registered")) {
    return {
      message:
        "This staff member has already confirmed their email. Use Send password setup link instead.",
      status: 400,
    };
  }

  if (message.includes("user not found")) {
    return {
      message: "No auth account was found for this staff member.",
      status: 404,
    };
  }

  return {
    message: "Unable to complete this action. Try again in a moment.",
    status: status && status >= 400 && status < 600 ? status : 400,
  };
}

function createPublicAuthClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase credentials.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function loadStaffMemberForAuthAction(
  adminClient: AdminClient,
  staffId: string
): Promise<
  | {
      ok: true;
      profile: StaffProfileRow;
      authUser: User;
      email: string;
    }
  | { ok: false; status: number; message: string }
> {
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, full_name, user_role, account_status")
    .eq("id", staffId)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, status: 404, message: "Staff member not found." };
  }

  if (!isStaffRole(profile.user_role)) {
    return {
      ok: false,
      status: 400,
      message: "This profile is not a staff account.",
    };
  }

  const { data: authData, error: authError } =
    await adminClient.auth.admin.getUserById(staffId);

  if (authError || !authData.user) {
    return {
      ok: false,
      status: 404,
      message: "No auth account was found for this staff member.",
    };
  }

  const email = authData.user.email?.trim().toLowerCase();

  if (!email) {
    return {
      ok: false,
      status: 400,
      message: "This staff member does not have an email address.",
    };
  }

  return {
    ok: true,
    profile,
    authUser: authData.user,
    email,
  };
}

export async function resendStaffInvite(
  staffId: string,
  origin: string
): Promise<StaffAuthActionResult> {
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

  const loaded = await loadStaffMemberForAuthAction(adminClient, staffId);

  if (!loaded.ok) {
    return loaded;
  }

  const authState = mapStaffAuthState(loaded.authUser);

  if (!canResendStaffInvite(authState)) {
    return {
      ok: false,
      status: 400,
      message: loaded.authUser.email_confirmed_at
        ? "This staff member has already confirmed their email. Use Send password setup link instead."
        : "This staff member is not eligible for a new invitation.",
    };
  }

  const redirectTo = buildInvitePasswordSetupRedirect(origin);

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    loaded.email,
    {
      data: {
        full_name: loaded.profile.full_name ?? undefined,
      },
      redirectTo,
    }
  );

  if (inviteError) {
    const mapped = mapStaffAuthActionError(inviteError);

    return {
      ok: false,
      status: mapped.status,
      message: mapped.message,
    };
  }

  return {
    ok: true,
    message: "Invitation resent successfully.",
  };
}

export async function sendStaffPasswordSetupLink(
  staffId: string,
  origin: string
): Promise<StaffAuthActionResult> {
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

  const loaded = await loadStaffMemberForAuthAction(adminClient, staffId);

  if (!loaded.ok) {
    return loaded;
  }

  const authState = mapStaffAuthState(loaded.authUser);

  if (!canSendStaffPasswordSetup(authState)) {
    return {
      ok: false,
      status: 400,
      message:
        "This staff member has not confirmed their email yet. Use Resend invite instead.",
    };
  }

  let publicAuthClient: SupabaseClient;

  try {
    publicAuthClient = createPublicAuthClient();
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message:
        error instanceof Error
          ? error.message
          : "Unable to initialise auth client.",
    };
  }

  const redirectTo = buildInvitePasswordSetupRedirect(origin);

  const { error: resetError } = await publicAuthClient.auth.resetPasswordForEmail(
    loaded.email,
    { redirectTo }
  );

  if (resetError) {
    const mapped = mapStaffAuthActionError(resetError);

    return {
      ok: false,
      status: mapped.status,
      message: mapped.message,
    };
  }

  return {
    ok: true,
    message: "Password setup link sent successfully.",
  };
}
