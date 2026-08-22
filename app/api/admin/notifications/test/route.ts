import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { getResendConfigStatus } from "@/lib/notifications/config";
import { getEmailMode } from "@/lib/notifications/email-mode";
import { sendNotification } from "@/lib/notifications/send-notification";
import type { TestableNotificationType } from "@/lib/notifications/notification-types";
import { TESTABLE_NOTIFICATION_TYPES } from "@/lib/notifications/notification-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SAMPLE_METADATA: Record<TestableNotificationType, Record<string, unknown>> = {
  quote_ready: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    quoteReference: "Q-1042",
    quoteId: "00000000-0000-0000-0000-000000000001",
    quoteUrl: "/quotes/00000000-0000-0000-0000-000000000001",
  },
  quote_accepted_confirmation: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
    nextStep: "Please upload your artwork when you're ready.",
  },
  artwork_uploaded_confirmation: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
    fileSummary: "sample-artwork.pdf",
  },
  new_quote_request: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    requiredDate: "2026-09-15",
    fulfilmentMethod: "delivery",
    quoteRequestId: "00000000-0000-0000-0000-000000000003",
    quoteRequestUrl: "/admin/quote-requests/00000000-0000-0000-0000-000000000003",
  },
  quote_accepted: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    acceptedValue: "£4,250.00",
    requiredDate: "2026-09-15",
    jobUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002",
  },
  artwork_uploaded: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    fileSummary: "sample-artwork.pdf",
    jobUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002",
  },
  job_ready_for_invoice: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    originalQuoteValue: "£4,250.00",
    additionsValue: "£150.00",
    cancellationsValue: "—",
    unpricedCount: 0,
    invoiceUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002/invoice",
  },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { recipientEmail?: string; notificationType?: string };

  try {
    body = (await request.json()) as { recipientEmail?: string; notificationType?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const notificationType = body.notificationType as TestableNotificationType | undefined;
  const recipientEmail = body.recipientEmail?.trim().toLowerCase();

  if (!recipientEmail) {
    return NextResponse.json({ error: "Recipient email is required." }, { status: 400 });
  }

  if (!notificationType || !TESTABLE_NOTIFICATION_TYPES.includes(notificationType)) {
    return NextResponse.json({ error: "Invalid notification type." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const result = await sendNotification(adminClient, {
    type: notificationType,
    recipientEmailOverride: recipientEmail,
    metadata: SAMPLE_METADATA[notificationType],
    idempotencyKey: `test:${notificationType}:${Date.now()}`,
  });

  return NextResponse.json({
    ok: result.ok,
    emailMode: getEmailMode(),
    resendConfig: getResendConfigStatus(),
    result,
  });
}
