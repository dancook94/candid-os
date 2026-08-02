import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { buildInvitePasswordSetupRedirect } from "@/lib/auth-invite-redirect";
import { inviteContactToPortal } from "@/lib/crm/invite-contact-portal";
import { createClient } from "@/lib/supabase/server";

type InviteCustomerBody = {
  contactId?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: InviteCustomerBody;

  try {
    body = (await request.json()) as InviteCustomerBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const contactId = body.contactId?.trim() ?? "";

  if (!contactId) {
    return NextResponse.json(
      {
        error:
          "Contact ID is required. Portal invitations must start from an existing contact.",
      },
      { status: 400 }
    );
  }

  const requestUrl = new URL(request.url);
  const redirectTo = buildInvitePasswordSetupRedirect(requestUrl.origin);

  const result = await inviteContactToPortal(supabase, contactId, redirectTo);

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    message: result.message,
    profileId: result.profileId,
  });
}
