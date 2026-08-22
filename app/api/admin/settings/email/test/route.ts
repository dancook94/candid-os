import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { getEmailMode } from "@/lib/notifications/email-mode";
import { sendEmailThroughResend } from "@/lib/notifications/resend-client";
import {
  renderSystemTestEmailHtml,
  SYSTEM_TEST_EMAIL_SUBJECT,
} from "@/lib/notifications/templates";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { recipientEmail?: string };

  try {
    body = (await request.json()) as { recipientEmail?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const recipientEmail = body.recipientEmail?.trim().toLowerCase();

  if (!recipientEmail) {
    return NextResponse.json({ error: "Recipient email is required." }, { status: 400 });
  }

  const result = await sendEmailThroughResend({
    intendedRecipient: recipientEmail,
    subject: SYSTEM_TEST_EMAIL_SUBJECT,
    html: renderSystemTestEmailHtml(),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        errorCode: result.errorCode,
        emailMode: getEmailMode(),
      },
      { status: 400 }
    );
  }

  if (result.status === "suppressed") {
    return NextResponse.json({
      ok: true,
      status: result.status,
      message:
        "Email delivery is disabled (EMAIL_MODE=disabled). No message was sent to Resend.",
      actualRecipient: result.actualRecipient,
      intendedRecipient: result.intendedRecipient,
      emailMode: getEmailMode(),
    });
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    message: result.redirected
      ? `Test email sent to ${result.actualRecipient} (redirected from ${result.intendedRecipient} by EMAIL_MODE=test).`
      : `Test email sent to ${result.actualRecipient}.`,
    providerMessageId: result.providerMessageId,
    actualRecipient: result.actualRecipient,
    intendedRecipient: result.intendedRecipient,
    redirected: result.redirected,
    emailMode: getEmailMode(),
  });
}
