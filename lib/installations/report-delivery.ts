import type { SupabaseClient } from "@supabase/supabase-js";

import {
  downloadCustomerPublishedReportBytes,
  loadCustomerPublishedInstallationReportFile,
} from "@/lib/installations/customer-reports";
import { INSTALLATION_REPORT_EMAIL_ATTACHMENT_MAX_BYTES } from "@/lib/installations/report-constants";
import { INSTALLATION_REPORT_MANAGER_SEND_BYPASSES_CONTACT_PREFERENCE } from "@/lib/installations/report-delivery-policy";
import { renderInstallationReportEmail } from "@/lib/installations/report-delivery-email";
import {
  assessInstallationReportRecipientPortalAccess,
  loadInstallationReportRecipientOptions,
} from "@/lib/installations/report-recipients";
import { sendNotification } from "@/lib/notifications/send-notification";
import { createAdminClient } from "@/lib/supabase/admin";

export type InstallationReportSendInput = {
  reportId: string;
  recipientEmail: string;
  customerMessage?: string | null;
  attachPdf?: boolean;
  confirmResend?: boolean;
  acknowledgeNoPortalAccess?: boolean;
  sentByProfileId: string;
};

export type InstallationReportSendPreview = {
  subject: string;
  html: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function installationReportDeliveryIdempotencyKey(
  reportId: string,
  recipientEmail: string,
  resend: boolean
) {
  const email = normalizeEmail(recipientEmail);
  if (resend) {
    return `installation_report_email:${reportId}:${email}:${Date.now()}`;
  }
  return `installation_report_email:${reportId}:${email}`;
}

export async function loadInstallationReportSendContext(
  adminClient: SupabaseClient,
  reportId: string
) {
  const { data: report, error } = await adminClient
    .from("installation_completion_reports")
    .select(
      `
        id,
        report_reference,
        version_number,
        installation_visit_id,
        installation_visits(
          visit_number,
          title,
          installation_project_id,
          installation_projects(
            job_id,
            title,
            company_id,
            jobs(job_reference, project_name, contact_id, contacts(full_name, email)),
            companies(company_name)
          )
        )
      `
    )
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!report) {
    throw new Error("Report not found.");
  }

  const visit = Array.isArray(report.installation_visits)
    ? report.installation_visits[0]
    : report.installation_visits;
  const project = visit && typeof visit === "object"
    ? Array.isArray(visit.installation_projects)
      ? visit.installation_projects[0]
      : visit.installation_projects
    : null;
  const job = project && typeof project === "object"
    ? Array.isArray(project.jobs)
      ? project.jobs[0]
      : project.jobs
    : null;
  const company = project && typeof project === "object"
    ? Array.isArray(project.companies)
      ? project.companies[0]
      : project.companies
    : null;
  const contact = job && typeof job === "object"
    ? Array.isArray(job.contacts)
      ? job.contacts[0]
      : job.contacts
    : null;

  const { data: published, error: publishError } = await adminClient
    .from("installation_visit_published_reports")
    .select("installation_completion_report_id")
    .eq("installation_visit_id", report.installation_visit_id)
    .maybeSingle();

  if (publishError && publishError.code !== "42P01") {
    throw new Error(publishError.message);
  }

  if (!published || published.installation_completion_report_id !== reportId) {
    throw new Error("Publish this report before sending it to the customer.");
  }

  const jobId = project && typeof project === "object" ? String(project.job_id) : "";
  if (!jobId) {
    throw new Error("This report is not linked to a customer job.");
  }

  return {
    reportId: String(report.id),
    reportReference: String(report.report_reference),
    versionNumber: Number(report.version_number) || 0,
    visitNumber: Number(visit && typeof visit === "object" ? visit.visit_number : 0) || 0,
    visitTitle: String(visit && typeof visit === "object" ? visit.title : "Installation visit"),
    projectTitle: String(project && typeof project === "object" ? project.title : "Installation"),
    companyId: String(project && typeof project === "object" ? project.company_id : ""),
    companyName: String(company && typeof company === "object" ? company.company_name : "Customer"),
    jobId,
    jobReference: String(job && typeof job === "object" ? job.job_reference : ""),
    projectName: String(job && typeof job === "object" ? job.project_name : ""),
    customerName: String(contact && typeof contact === "object" ? contact.full_name : "Customer"),
    defaultRecipientEmail:
      contact && typeof contact === "object" && typeof contact.email === "string"
        ? contact.email
        : null,
    contactId:
      job && typeof job === "object" && typeof job.contact_id === "string" ? job.contact_id : null,
    jobContactId:
      job && typeof job === "object" && typeof job.contact_id === "string" ? job.contact_id : null,
    visitId: String(report.installation_visit_id),
    portalUrl: `/jobs/${jobId}#installation-report-${reportId}`,
    managerSendBypassesContactPreference: INSTALLATION_REPORT_MANAGER_SEND_BYPASSES_CONTACT_PREFERENCE,
  };
}

export async function loadInstallationReportSendRecipients(
  adminClient: SupabaseClient,
  context: Awaited<ReturnType<typeof loadInstallationReportSendContext>>
) {
  return loadInstallationReportRecipientOptions(adminClient, {
    companyId: context.companyId,
    jobContactId: context.jobContactId,
  });
}

export function previewInstallationReportEmail(
  context: Awaited<ReturnType<typeof loadInstallationReportSendContext>>,
  customerMessage?: string | null
): InstallationReportSendPreview {
  return renderInstallationReportEmail({
    customerName: context.customerName,
    companyName: context.companyName,
    jobReference: context.jobReference,
    projectName: context.projectName || context.projectTitle,
    reportReference: context.reportReference,
    visitNumber: context.visitNumber,
    visitTitle: context.visitTitle,
    portalUrl: context.portalUrl,
    customerMessage,
  });
}

export async function listInstallationReportDeliveries(
  adminClient: SupabaseClient,
  reportId: string
) {
  const { data, error } = await adminClient
    .from("installation_completion_report_deliveries")
    .select(
      "id, report_reference, version_number, recipient_email, sent_at, attach_pdf, provider_status, provider_message_id, error_message, sent_by_profile_id, profiles!installation_completion_report_deliveries_sent_by_profile_id_fkey(full_name)"
    )
    .eq("installation_completion_report_id", reportId)
    .order("sent_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") {
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: String(row.id),
      reportReference: String(row.report_reference),
      versionNumber: Number(row.version_number) || 0,
      recipientEmail: String(row.recipient_email),
      sentAt: String(row.sent_at),
      attachPdf: Boolean(row.attach_pdf),
      providerStatus: typeof row.provider_status === "string" ? row.provider_status : null,
      providerMessageId: typeof row.provider_message_id === "string" ? row.provider_message_id : null,
      errorMessage: typeof row.error_message === "string" ? row.error_message : null,
      sentByName:
        profile && typeof profile === "object" && typeof profile.full_name === "string"
          ? profile.full_name
          : null,
    };
  });
}

async function findDeliveryDuplicate(
  adminClient: SupabaseClient,
  idempotencyKey: string
) {
  const { data, error } = await adminClient
    .from("installation_completion_report_deliveries")
    .select("id, sent_at, recipient_email")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return null;
    }
    throw new Error(error.message);
  }

  return data;
}

export async function sendInstallationReportToCustomer(
  input: InstallationReportSendInput
): Promise<{
  ok: boolean;
  duplicate?: boolean;
  deliveryId?: string;
  error?: string;
  notificationId?: string | null;
  requiresPortalAcknowledgement?: boolean;
}> {
  const adminClient = createAdminClient();
  const context = await loadInstallationReportSendContext(adminClient, input.reportId);
  const recipientEmail = normalizeEmail(input.recipientEmail);

  if (!recipientEmail.includes("@")) {
    return { ok: false, error: "Enter a valid customer email address." };
  }

  const portal = await assessInstallationReportRecipientPortalAccess(adminClient, {
    companyId: context.companyId,
    recipientEmail,
  });
  if (!portal.hasPortalAccess && !input.acknowledgeNoPortalAccess) {
    return {
      ok: false,
      error:
        "This recipient does not have Candid OS portal access. They may still receive the email, but cannot open the secure report link until they are invited. Confirm to continue.",
      requiresPortalAcknowledgement: true,
    };
  }

  const idempotencyKey = installationReportDeliveryIdempotencyKey(
    input.reportId,
    recipientEmail,
    Boolean(input.confirmResend)
  );

  if (!input.confirmResend) {
    const duplicate = await findDeliveryDuplicate(adminClient, idempotencyKey);
    if (duplicate) {
      return {
        ok: false,
        duplicate: true,
        error: "This report was already sent to that email address. Confirm resend to continue.",
      };
    }
  }

  let attachments: Array<{ filename: string; content: string }> | undefined;
  if (input.attachPdf) {
    const file = await loadCustomerPublishedInstallationReportFile(adminClient, {
      jobId: context.jobId,
      companyId: context.companyId,
      reportId: input.reportId,
    });
    if (file.byteSize > INSTALLATION_REPORT_EMAIL_ATTACHMENT_MAX_BYTES) {
      return {
        ok: false,
        error: `This PDF is too large to attach (${Math.ceil(file.byteSize / 1_000_000)} MB). Send the portal link without an attachment or choose a smaller saved version.`,
      };
    }
    const bytes = await downloadCustomerPublishedReportBytes(adminClient, file);
    attachments = [
      {
        filename: `${file.reportReference}.pdf`,
        content: Buffer.from(bytes).toString("base64"),
      },
    ];
  }

  const notification = await sendNotification(adminClient, {
    type: "installation_report_available",
    companyId: context.companyId,
    contactId: context.contactId,
    jobId: context.jobId,
    recipientEmailOverride: recipientEmail,
    idempotencyKey,
    attachments,
    metadata: {
      customerName: context.customerName,
      companyName: context.companyName,
      jobReference: context.jobReference,
      projectName: context.projectName || context.projectTitle,
      reportReference: context.reportReference,
      versionNumber: context.versionNumber,
      visitNumber: context.visitNumber,
      visitTitle: context.visitTitle,
      jobId: context.jobId,
      jobUrl: context.portalUrl,
      reportUrl: context.portalUrl,
      customerMessage: input.customerMessage?.trim() || null,
      attachPdf: Boolean(input.attachPdf),
    },
  });

  if (notification.duplicate) {
    return {
      ok: false,
      duplicate: true,
      error: "This send was already recorded.",
      notificationId: notification.results[0]?.notificationId ?? null,
    };
  }

  const primary = notification.results[0];
  const providerAccepted = notification.ok && primary?.status === "sent";

  const deliveryInsert = await adminClient.from("installation_completion_report_deliveries").insert({
    installation_completion_report_id: input.reportId,
    report_reference: context.reportReference,
    version_number: context.versionNumber,
    recipient_email: recipientEmail,
    sent_by_profile_id: input.sentByProfileId,
    attach_pdf: Boolean(input.attachPdf),
    customer_message: input.customerMessage?.trim() || null,
    notification_id: primary?.notificationId ?? null,
    provider_status: primary?.status ?? (providerAccepted ? "sent" : "failed"),
    provider_message_id: primary?.providerMessageId ?? null,
    error_message: providerAccepted
      ? null
      : primary?.error ?? notification.failureReason ?? "The email provider did not accept the message.",
    idempotency_key: providerAccepted ? idempotencyKey : null,
  }).select("id").single();

  if (!providerAccepted) {
    return {
      ok: false,
      error:
        primary?.error ??
        notification.failureReason ??
        "The email provider did not accept the message.",
      deliveryId: deliveryInsert.data?.id ? String(deliveryInsert.data.id) : undefined,
    };
  }

  return {
    ok: true,
    deliveryId: deliveryInsert.data?.id ? String(deliveryInsert.data.id) : undefined,
    notificationId: primary?.notificationId ?? null,
  };
}

export async function loadPublishedReportForManagerCheck(
  adminClient: SupabaseClient,
  visitId: string
) {
  const { data, error } = await adminClient
    .from("installation_visit_published_reports")
    .select(
      "installation_completion_report_id, published_at, published_by_profile_id, profiles!installation_visit_published_reports_published_by_profile_id_fkey(full_name)"
    )
    .eq("installation_visit_id", visitId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return null;
    }
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  const profile = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
  return {
    reportId: String(data.installation_completion_report_id),
    publishedAt: String(data.published_at),
    publishedByProfileId: String(data.published_by_profile_id),
    publishedByName:
      profile && typeof profile === "object" && typeof profile.full_name === "string"
        ? profile.full_name
        : null,
  };
}
