import { getAppBaseUrl, getResendFromAddress } from "@/lib/notifications/config";
import {
  getArtworkReceivedManuallyParagraphs,
  getCandidCreatingArtworkParagraphs,
  getCustomerArtworkUploadConfirmationParagraphs,
} from "@/lib/notifications/artwork-copy";
import {
  normalizeNotificationType,
  type NotificationType,
} from "@/lib/notifications/notification-types";

const ACCENT = "#fbd12c";
const TEXT = "#1a1a1a";
const MUTED = "#666666";

export type EmailTemplateContent = {
  preheader?: string;
  headline: string;
  bodyParagraphs: string[];
  detailRows?: Array<{ label: string; value: string }>;
  statusLabel?: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerNote?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmailShell(content: EmailTemplateContent) {
  const detailRows = (content.detailRows ?? [])
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 0;color:${MUTED};font-size:14px;width:140px;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 0;color:${TEXT};font-size:14px;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>`
    )
    .join("");

  const paragraphs = content.bodyParagraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:${TEXT};font-size:16px;line-height:1.5;">${escapeHtml(paragraph)}</p>`
    )
    .join("");

  const cta =
    content.ctaLabel && content.ctaHref
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px;">
          <tr>
            <td style="border-radius:8px;background:${ACCENT};">
              <a href="${escapeHtml(content.ctaHref)}" style="display:inline-block;padding:14px 24px;color:${TEXT};font-size:16px;font-weight:700;text-decoration:none;">${escapeHtml(content.ctaLabel)}</a>
            </td>
          </tr>
        </table>`
      : "";

  const statusBadge = content.statusLabel
    ? `<span style="display:inline-block;background:#f3f4f6;color:${TEXT};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:6px 10px;border-radius:999px;margin-bottom:16px;">${escapeHtml(content.statusLabel)}</span>`
    : "";

  const preheader = content.preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(content.preheader)}</span>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(content.headline)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    ${preheader}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
            <tr>
              <td style="height:6px;background:${ACCENT};"></td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px;">
                <div style="font-size:22px;font-weight:800;color:${TEXT};letter-spacing:-0.02em;">Candid Creative</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px;">
                ${statusBadge}
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:${TEXT};">${escapeHtml(content.headline)}</h1>
                ${paragraphs}
                ${
                  detailRows
                    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 16px;border-top:1px solid #ececec;padding-top:8px;">${detailRows}</table>`
                    : ""
                }
                ${cta}
                ${
                  content.footerNote
                    ? `<p style="margin:16px 0 0;color:${MUTED};font-size:13px;line-height:1.5;">${escapeHtml(content.footerNote)}</p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:#fafafa;border-top:1px solid #ececec;color:${MUTED};font-size:12px;line-height:1.5;">
                Candid Creative Limited · Innovation House, Cray Road, Sidcup DA14 5DP<br />
                020 3149 8995 · www.candidcreative.uk
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildAbsoluteUrl(path: string) {
  const base = getAppBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function renderNotificationEmail(
  type: NotificationType,
  metadata: Record<string, unknown>
) {
  const normalizedType = normalizeNotificationType(type);
  const project = String(metadata.projectName ?? metadata.project ?? "your project");
  const company = String(metadata.companyName ?? "your company");
  const customerName = String(metadata.customerName ?? metadata.firstName ?? "there");
  const jobReference = String(metadata.jobReference ?? "");
  const quoteReference = String(metadata.quoteReference ?? "");

  switch (normalizedType) {
    case "customer_registration_received":
      return {
        subject: "Registration received — Candid OS",
        html: renderEmailShell({
          preheader: "Your Candid OS registration has been received.",
          headline: "Your Candid OS registration has been received",
          bodyParagraphs: [
            `Hi ${customerName},`,
            "Thank you for registering with Candid Creative.",
            String(
              metadata.approvalCopy ??
                "We'll review your account before portal access is approved."
            ),
            ...(metadata.accountStatus === "approved"
              ? []
              : ["You'll receive another email once your account is ready."]),
          ],
          detailRows: [
            { label: "Name", value: customerName },
            ...(company ? [{ label: "Company", value: company }] : []),
            { label: "Email", value: String(metadata.email ?? "") },
            {
              label: "Registered",
              value: String(metadata.registrationDate ?? "Recently"),
            },
          ],
        }),
      };

    case "customer_account_approved":
      return {
        subject: "Your Candid OS account is ready",
        html: renderEmailShell({
          preheader: "Your Candid OS account has been approved.",
          headline: "Welcome to Candid OS",
          bodyParagraphs: [
            `Hi ${customerName},`,
            "Your Candid OS account is now approved. You can use the portal to request quotations, view and accept quotes, upload artwork, view jobs, and receive production updates.",
          ],
          ctaLabel: "Log in to Candid OS",
          ctaHref: buildAbsoluteUrl("/login"),
        }),
      };

    case "quote_ready":
      return {
        subject: `Your quotation is ready — ${project}`,
        html: renderEmailShell({
          preheader: `Your quotation for ${project} is ready to review.`,
          headline: "Your quotation is ready",
          bodyParagraphs: [
            `Hi ${customerName},`,
            `We've prepared a quotation for ${project}. You can review the full details, options and pricing in Candid OS.`,
          ],
          detailRows: [
            { label: "Project", value: project },
            { label: "Company", value: company },
            ...(quoteReference ? [{ label: "Quote", value: quoteReference }] : []),
            ...(metadata.quoteTotal
              ? [{ label: "Total", value: String(metadata.quoteTotal) }]
              : []),
            ...(metadata.quoteVersion
              ? [{ label: "Version", value: String(metadata.quoteVersion) }]
              : []),
          ],
          ctaLabel: "View quotation",
          ctaHref: buildAbsoluteUrl(String(metadata.quoteUrl ?? `/quotes/${metadata.quoteId ?? ""}`)),
        }),
      };

    case "quote_accepted_customer":
      return {
        subject: `Quotation accepted — ${project}`,
        html: renderEmailShell({
          headline: "Thank you — your quotation has been accepted",
          bodyParagraphs: [
            `Hi ${customerName},`,
            `Thank you for accepting the quotation for ${project}.`,
            String(metadata.nextStep ?? "Your job has now been created in Candid OS."),
          ],
          detailRows: [
            ...(quoteReference ? [{ label: "Quote", value: quoteReference }] : []),
            ...(jobReference ? [{ label: "Job", value: jobReference }] : []),
            { label: "Project", value: project },
            ...(metadata.acceptedValue
              ? [{ label: "Accepted value", value: String(metadata.acceptedValue) }]
              : []),
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "quote_accepted_confirmation":
      return renderNotificationEmail("quote_accepted_customer", metadata);

    case "customer_artwork_received":
      return {
        subject: `Artwork received — ${jobReference || project}`,
        html: renderEmailShell({
          headline: "We've received your artwork",
          bodyParagraphs: [
            `Hi ${customerName},`,
            ...getCustomerArtworkUploadConfirmationParagraphs(),
          ],
          detailRows: [
            ...(jobReference ? [{ label: "Job reference", value: jobReference }] : []),
            { label: "Project", value: project },
            {
              label: "Files",
              value: String(metadata.fileSummary ?? metadata.fileNames ?? "Artwork uploaded"),
            },
            ...(metadata.fileCount
              ? [{ label: "Number of files", value: String(metadata.fileCount) }]
              : []),
            ...(metadata.uploadNote && metadata.uploadNote !== "No note"
              ? [{ label: "Upload note", value: String(metadata.uploadNote) }]
              : []),
            ...(metadata.uploadedAt
              ? [{ label: "Uploaded", value: String(metadata.uploadedAt) }]
              : []),
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "artwork_received_manually":
      return {
        subject: `Artwork received — ${jobReference || project}`,
        html: renderEmailShell({
          headline: "Your artwork has been received",
          bodyParagraphs: [
            `Hi ${customerName},`,
            ...getArtworkReceivedManuallyParagraphs(),
          ],
          detailRows: [
            ...(jobReference ? [{ label: "Job reference", value: jobReference }] : []),
            { label: "Project", value: project },
            {
              label: "Artwork status",
              value: String(metadata.artworkStatusLabel ?? "Artwork received"),
            },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "candid_creating_artwork":
      return {
        subject: `Artwork in preparation — ${jobReference || project}`,
        html: renderEmailShell({
          headline: "We're preparing your artwork",
          bodyParagraphs: [
            `Hi ${customerName},`,
            ...getCandidCreatingArtworkParagraphs(Boolean(metadata.proofRequired ?? true)),
          ],
          detailRows: [
            ...(jobReference ? [{ label: "Job reference", value: jobReference }] : []),
            { label: "Project", value: project },
            {
              label: "Artwork status",
              value: String(metadata.artworkStatusLabel ?? "Artwork in preparation"),
            },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "internal_artwork_uploaded":
      return {
        subject: jobReference
          ? `Artwork uploaded — ${jobReference} — ${project}`
          : `Artwork uploaded — ${project}`,
        html: renderEmailShell({
          headline: "Customer artwork uploaded",
          bodyParagraphs: [
            `${customerName} at ${company} uploaded artwork for ${jobReference || project}.`,
          ],
          detailRows: [
            { label: "Company", value: company },
            { label: "Customer", value: customerName },
            ...(jobReference ? [{ label: "Job reference", value: jobReference }] : []),
            { label: "Project", value: project },
            {
              label: "Files",
              value: String(metadata.fileSummary ?? metadata.fileNames ?? "Artwork uploaded"),
            },
            ...(metadata.fileSizes
              ? [{ label: "File size(s)", value: String(metadata.fileSizes) }]
              : []),
            ...(metadata.uploadNote && metadata.uploadNote !== "No note"
              ? [{ label: "Customer note", value: String(metadata.uploadNote) }]
              : []),
            {
              label: "Artwork source",
              value: String(metadata.artworkSourceLabel ?? "Portal upload"),
            },
            ...(metadata.uploadedAt
              ? [{ label: "Uploaded", value: String(metadata.uploadedAt) }]
              : []),
            {
              label: "Dropbox status",
              value: String(metadata.dropboxStatus ?? "Stored in Dropbox"),
            },
          ],
          ctaLabel: "Review artwork",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/admin/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "internal_quote_request_received":
    case "new_quote_request":
      return {
        subject: `New quote request — ${project}`,
        html: renderEmailShell({
          headline: "New quote request",
          bodyParagraphs: [
            `${customerName} at ${company} submitted a new quote request for ${project}.`,
          ],
          detailRows: [
            { label: "Customer", value: customerName },
            { label: "Company", value: company },
            { label: "Project", value: project },
            {
              label: "Required date",
              value: String(metadata.requiredDate ?? "Not specified"),
            },
            {
              label: "Required time",
              value: String(metadata.requiredTime ?? "Not specified"),
            },
            {
              label: "Fulfilment",
              value: String(metadata.fulfilmentMethod ?? "Not specified"),
            },
            ...(metadata.deliveryAddress
              ? [{ label: "Delivery address", value: String(metadata.deliveryAddress) }]
              : []),
            ...(metadata.purchaseOrderNumber
              ? [{ label: "PO / reference", value: String(metadata.purchaseOrderNumber) }]
              : []),
            ...(metadata.customerNotes
              ? [{ label: "Customer notes", value: String(metadata.customerNotes) }]
              : []),
            {
              label: "Attachments",
              value: String(metadata.attachmentCount ?? "0"),
            },
            {
              label: "Submitted",
              value: String(metadata.submittedAt ?? "Recently"),
            },
          ],
          ctaLabel: "Review quote request",
          ctaHref: buildAbsoluteUrl(
            String(metadata.quoteRequestUrl ?? `/admin/quote-requests/${metadata.quoteRequestId ?? ""}`)
          ),
        }),
      };

    case "internal_new_registration":
      return {
        subject: `New Candid OS registration — ${customerName}`,
        html: renderEmailShell({
          headline: "New Candid OS registration",
          bodyParagraphs: [
            "A new customer registration was received in Candid OS.",
          ],
          detailRows: [
            { label: "Customer", value: customerName },
            { label: "Email", value: String(metadata.email ?? "") },
            { label: "Company", value: company },
            {
              label: "Registered",
              value: String(metadata.registrationDate ?? "Recently"),
            },
            {
              label: "Account status",
              value: String(metadata.accountStatus ?? "pending"),
            },
          ],
          ctaLabel: "Review customer",
          ctaHref: buildAbsoluteUrl("/admin"),
        }),
      };

    case "quote_accepted_internal":
      return {
        subject: `Quote accepted — ${jobReference || quoteReference} — ${project}`,
        html: renderEmailShell({
          headline: "Quote accepted",
          bodyParagraphs: [
            `${company} accepted the quotation for ${project}.`,
          ],
          detailRows: [
            { label: "Company", value: company },
            { label: "Customer", value: customerName },
            ...(quoteReference ? [{ label: "Quote", value: quoteReference }] : []),
            ...(jobReference ? [{ label: "Job", value: jobReference }] : []),
            {
              label: "Accepted value",
              value: String(metadata.acceptedValue ?? "See quote"),
            },
            {
              label: "Required date",
              value: String(metadata.requiredDate ?? "Not specified"),
            },
            {
              label: "Fulfilment",
              value: String(metadata.fulfilmentMethod ?? "Not specified"),
            },
            {
              label: "Artwork",
              value: String(metadata.artworkStatusLabel ?? "Not specified"),
            },
            ...(metadata.purchaseOrderNumber &&
            metadata.purchaseOrderNumber !== "Not supplied"
              ? [{ label: "PO / reference", value: String(metadata.purchaseOrderNumber) }]
              : []),
          ],
          ctaLabel: "Open job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/admin/jobs/${metadata.jobId ?? ""}`)),
          footerNote: metadata.opportunityUrl
            ? `Opportunity: ${buildAbsoluteUrl(String(metadata.opportunityUrl))}`
            : undefined,
        }),
      };

    case "quote_accepted":
      return renderNotificationEmail("quote_accepted_internal", metadata);

    case "proof_ready": {
      const proofVersionNumber =
        metadata.versionNumber != null ? Number(metadata.versionNumber) : null;
      const versionSubject =
        proofVersionNumber != null
          ? `Proof v${proofVersionNumber} ready for approval — ${jobReference} — ${project}`
          : `Proof ready for approval — ${jobReference} — ${project}`;

      return {
        subject: versionSubject,
        html: renderEmailShell({
          preheader: `Your proof for ${project} is ready to review.`,
          headline: "Your proof is ready to review",
          bodyParagraphs: [
            `Hi ${customerName},`,
            `We've prepared a proof for ${project}. Please review the artwork, content, dimensions and specification in Candid OS before approving.`,
            ...(metadata.customerMessage
              ? [String(metadata.customerMessage)]
              : []),
          ],
          detailRows: [
            { label: "Job", value: jobReference || "—" },
            { label: "Project", value: project },
            { label: "Proof", value: String(metadata.proofTitle ?? "—") },
            {
              label: "Proof version",
              value: metadata.versionNumber != null
                ? String(metadata.versionNumber)
                : String(metadata.proofVersion ?? "—"),
            },
            ...(metadata.relatedItems
              ? [{ label: "Items", value: String(metadata.relatedItems) }]
              : []),
          ],
          ctaLabel: "Review proof",
          ctaHref: buildAbsoluteUrl(
            String(metadata.proofUrl ?? metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)
          ),
        }),
      };
    }

    case "proof_approved_customer":
      return {
        subject: `Proof approved — ${jobReference}`,
        html: renderEmailShell({
          preheader: `Your proof approval for ${jobReference} has been recorded.`,
          headline: "Your proof has been approved",
          bodyParagraphs: [
            `Hi ${customerName},`,
            "Thank you for approving your proof. Your approval has been recorded and your job can continue toward production.",
          ],
          detailRows: [
            { label: "Job", value: jobReference || "—" },
            { label: "Project", value: project },
            { label: "Proof", value: String(metadata.proofTitle ?? "—") },
            { label: "Version", value: String(metadata.proofVersion ?? "—") },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(
            String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)
          ),
        }),
      };

    case "proof_approved_internal":
      return {
        subject: `Proof approved — ${jobReference} — ${project}`,
        html: renderEmailShell({
          headline: "Proof approved by customer",
          bodyParagraphs: [
            `${customerName} at ${company} approved the proof for ${project}.`,
          ],
          detailRows: [
            { label: "Customer", value: customerName },
            { label: "Company", value: company },
            { label: "Job", value: jobReference || "—" },
            { label: "Project", value: project },
            { label: "Proof", value: String(metadata.proofTitle ?? "—") },
            { label: "Version", value: String(metadata.proofVersion ?? "—") },
            { label: "Approved by", value: String(metadata.approvedBy ?? customerName) },
            {
              label: "Approved at",
              value: String(metadata.approvedAt ?? "Recently"),
            },
            ...(metadata.relatedItems
              ? [{ label: "Items", value: String(metadata.relatedItems) }]
              : []),
          ],
          ctaLabel: "Open job",
          ctaHref: buildAbsoluteUrl(
            String(metadata.jobUrl ?? `/admin/jobs/${metadata.jobId ?? ""}`)
          ),
        }),
      };

    case "proof_changes_requested_customer":
      return {
        subject: `Changes requested — ${jobReference}`,
        html: renderEmailShell({
          preheader: `We've received your proof change request for ${jobReference}.`,
          headline: "We've received your changes",
          bodyParagraphs: [
            `Hi ${customerName},`,
            "Thank you for your feedback. Candid will review the requested amendments and send a new proof version when ready.",
          ],
          detailRows: [
            { label: "Job", value: jobReference || "—" },
            { label: "Project", value: project },
            { label: "Proof", value: String(metadata.proofTitle ?? "—") },
            { label: "Version", value: String(metadata.proofVersion ?? "—") },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(
            String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)
          ),
        }),
      };

    case "proof_changes_requested_internal":
      return {
        subject: `Proof changes requested — ${jobReference} — ${project}`,
        html: renderEmailShell({
          headline: "Proof changes requested",
          bodyParagraphs: [
            `${customerName} at ${company} requested changes to the proof for ${project}.`,
          ],
          detailRows: [
            { label: "Customer", value: customerName },
            { label: "Company", value: company },
            { label: "Job", value: jobReference || "—" },
            { label: "Proof", value: String(metadata.proofTitle ?? "—") },
            { label: "Version", value: String(metadata.proofVersion ?? "—") },
            {
              label: "Customer comments",
              value: String(metadata.customerComment ?? "—"),
            },
            ...(metadata.relatedItems
              ? [{ label: "Items", value: String(metadata.relatedItems) }]
              : []),
            {
              label: "Requested at",
              value: String(metadata.requestedAt ?? "Recently"),
            },
          ],
          ctaLabel: "Review proof",
          ctaHref: buildAbsoluteUrl(
            String(metadata.jobUrl ?? `/admin/jobs/${metadata.jobId ?? ""}`)
          ),
        }),
      };

    case "job_ready_for_invoice":
      return {
        subject: `Job ready for invoice — ${jobReference || project}`,
        html: renderEmailShell({
          headline: "Job ready for invoice review",
          bodyParagraphs: [
            `${jobReference || project} is ready for invoice review in Candid OS.`,
          ],
          detailRows: [
            { label: "Company", value: company },
            { label: "Original quote", value: String(metadata.originalQuoteValue ?? "—") },
            { label: "Additions", value: String(metadata.additionsValue ?? "—") },
            { label: "Cancellations", value: String(metadata.cancellationsValue ?? "—") },
            {
              label: "Unpriced items",
              value: String(metadata.unpricedCount ?? "0"),
            },
          ],
          ctaLabel: "Review invoice",
          ctaHref: buildAbsoluteUrl(
            String(metadata.invoiceUrl ?? `/admin/jobs/${metadata.jobId ?? ""}/invoice`)
          ),
        }),
      };

    default:
      return {
        subject: `Candid Creative notification — ${type}`,
        html: renderEmailShell({
          headline: "Candid Creative update",
          bodyParagraphs: ["You have a new update in Candid OS."],
          detailRows: [{ label: "Type", value: type }],
          ctaLabel: "Open Candid OS",
          ctaHref: getAppBaseUrl(),
        }),
      };
  }
}

export function renderSystemTestEmailHtml() {
  return renderEmailShell({
    preheader: "Your Candid OS email notifications are configured correctly.",
    headline: "Candid OS email test",
    bodyParagraphs: [
      "Your Candid OS email notifications are configured correctly.",
      "This test confirms that Candid OS can successfully send email notifications through Resend.",
    ],
  });
}

export const SYSTEM_TEST_EMAIL_SUBJECT = "Candid OS email test";

export function getPlainTextFromHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getFromHeader() {
  const { fromEmail, fromName } = getResendFromAddress();
  return `${fromName} <${fromEmail}>`;
}
