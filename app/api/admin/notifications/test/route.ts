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
  customer_registration_received: {
    customerName: "Alex Sample",
    firstName: "Alex",
    companyName: "Sample Customer Ltd",
    email: "alex@example.com",
    registrationDate: "22 Aug 2026, 14:30",
    accountStatus: "pending",
    approvalCopy:
      "Candid Creative will review your account before portal access is approved.",
  },
  customer_account_approved: {
    customerName: "Alex Sample",
    firstName: "Alex",
    companyName: "Sample Customer Ltd",
    email: "alex@example.com",
  },
  internal_new_registration: {
    customerName: "Alex Sample",
    companyName: "Sample Customer Ltd",
    email: "alex@example.com",
    registrationDate: "22 Aug 2026, 14:30",
    accountStatus: "pending",
  },
  internal_quote_request_received: {
    customerName: "Alex Sample",
    companyName: "Sample Customer Ltd",
    projectName: "Sample Exhibition Stand",
    requiredDate: "2026-09-15",
    requiredTime: "09:00",
    fulfilmentMethod: "Delivery",
    deliveryAddress: "1 Sample Street, London, SW1A 1AA",
    purchaseOrderNumber: "PO-1042",
    customerNotes: "Please include delivery instructions.",
    attachmentCount: "2",
    submittedAt: "22 Aug 2026, 14:30",
    quoteRequestId: "00000000-0000-0000-0000-000000000003",
    quoteRequestUrl: "/admin/quote-requests/00000000-0000-0000-0000-000000000003",
  },
  quote_ready: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    quoteReference: "Q-1042",
    quoteTotal: "£4,250.00",
    quoteVersion: "Version 1",
    quoteId: "00000000-0000-0000-0000-000000000001",
    quoteUrl: "/quotes/00000000-0000-0000-0000-000000000001",
  },
  quote_accepted_customer: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    quoteReference: "Q-1042",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
    acceptedValue: "£4,250.00",
    nextStep: "Your job has now been created. You can upload artwork from the job page.",
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
  customer_artwork_received: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
    fileSummary: "sample-artwork.pdf",
    fileCount: "1",
    uploadNote: "Please use CMYK version.",
    uploadedAt: "22 Aug 2026, 14:30",
  },
  artwork_received_manually: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
    artworkStatusLabel: "Artwork received",
  },
  candid_creating_artwork: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
    artworkStatusLabel: "Artwork in preparation",
    proofRequired: true,
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
    quoteReference: "Q-1042",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    acceptedValue: "£4,250.00",
    requiredDate: "2026-09-15",
    fulfilmentMethod: "delivery",
    artworkStatusLabel: "Awaiting customer artwork",
    jobUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002",
  },
  quote_accepted_internal: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    quoteReference: "Q-1042",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    acceptedValue: "£4,250.00",
    requiredDate: "2026-09-15",
    fulfilmentMethod: "delivery",
    artworkStatusLabel: "Awaiting customer artwork",
    jobUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002",
    opportunityUrl: "/admin/opportunities/00000000-0000-0000-0000-000000000004",
  },
  internal_artwork_uploaded: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    fileSummary: "sample-artwork.pdf",
    fileSizes: "2.4 MB",
    uploadNote: "Please use CMYK version.",
    artworkSourceLabel: "Portal upload",
    uploadedAt: "22 Aug 2026, 14:30",
    dropboxStatus: "Stored in Dropbox",
    jobUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002",
  },
  proof_ready: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    proofId: "00000000-0000-0000-0000-000000000010",
    proofTitle: "Lobby panels proof",
    proofVersion: "v1",
    relatedItems: "LI-01 · Lobby panel",
    customerMessage: "Please check the logo size before approving.",
    proofUrl: "/jobs/00000000-0000-0000-0000-000000000002#proof-00000000-0000-0000-0000-000000000010",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
  },
  proof_approved_customer: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    proofTitle: "Lobby panels proof",
    proofVersion: "v1",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
  },
  proof_approved_internal: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    proofTitle: "Lobby panels proof",
    proofVersion: "v1",
    approvedBy: "Alex Sample",
    approvedAt: "22 Aug 2026, 14:30",
    relatedItems: "LI-01 · Lobby panel",
    jobUrl: "/admin/jobs/00000000-0000-0000-0000-000000000002",
  },
  proof_changes_requested_customer: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    proofTitle: "Lobby panels proof",
    proofVersion: "v1",
    jobUrl: "/jobs/00000000-0000-0000-0000-000000000002",
  },
  proof_changes_requested_internal: {
    projectName: "Sample Exhibition Stand",
    companyName: "Sample Customer Ltd",
    customerName: "Alex Sample",
    jobReference: "J-1042",
    jobId: "00000000-0000-0000-0000-000000000002",
    proofTitle: "Lobby panels proof",
    proofVersion: "v1",
    customerComment: "Please increase the logo size by 10mm.",
    relatedItems: "LI-01 · Lobby panel",
    requestedAt: "22 Aug 2026, 14:30",
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
