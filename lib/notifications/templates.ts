import { getAppBaseUrl, getResendFromAddress } from "@/lib/notifications/config";
import type { NotificationType } from "@/lib/notifications/notification-types";

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
  const project = String(metadata.projectName ?? metadata.project ?? "your project");
  const company = String(metadata.companyName ?? "your company");
  const customerName = String(metadata.customerName ?? "there");
  const jobReference = String(metadata.jobReference ?? "");
  const quoteReference = String(metadata.quoteReference ?? "");

  switch (type) {
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
          ],
          ctaLabel: "View quotation",
          ctaHref: buildAbsoluteUrl(String(metadata.quoteUrl ?? `/quotes/${metadata.quoteId ?? ""}`)),
        }),
      };

    case "quote_accepted_confirmation":
      return {
        subject: `Quotation accepted — ${project}`,
        html: renderEmailShell({
          headline: "Quotation accepted",
          bodyParagraphs: [
            `Hi ${customerName},`,
            `Thank you for accepting the quotation for ${project}. Your job is now being set up in Candid OS.`,
            String(metadata.nextStep ?? "We'll be in touch about artwork and next steps shortly."),
          ],
          detailRows: [
            { label: "Project", value: project },
            ...(jobReference ? [{ label: "Job", value: jobReference }] : []),
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "artwork_uploaded_confirmation":
      return {
        subject: `Artwork received — ${jobReference || project}`,
        html: renderEmailShell({
          headline: "Artwork received",
          bodyParagraphs: [
            `Hi ${customerName},`,
            `We've received your artwork for ${project}.`,
            "You can still upload additional files in Candid OS if needed.",
          ],
          detailRows: [
            ...(jobReference ? [{ label: "Job", value: jobReference }] : []),
            {
              label: "Files",
              value: String(metadata.fileSummary ?? "Artwork uploaded"),
            },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/jobs/${metadata.jobId ?? ""}`)),
        }),
      };

    case "new_quote_request":
      return {
        subject: `New quote request — ${project}`,
        html: renderEmailShell({
          headline: "New quote request",
          bodyParagraphs: [
            `${company} submitted a new quote request for ${project}.`,
          ],
          detailRows: [
            { label: "Customer", value: customerName },
            { label: "Company", value: company },
            { label: "Required date", value: String(metadata.requiredDate ?? "Not specified") },
            {
              label: "Fulfilment",
              value: String(metadata.fulfilmentMethod ?? "Not specified"),
            },
          ],
          ctaLabel: "View quote request",
          ctaHref: buildAbsoluteUrl(
            String(metadata.quoteRequestUrl ?? `/admin/quote-requests/${metadata.quoteRequestId ?? ""}`)
          ),
        }),
      };

    case "quote_accepted":
      return {
        subject: `Quote accepted — ${project}`,
        html: renderEmailShell({
          headline: "Quote accepted",
          bodyParagraphs: [
            `${company} accepted the quotation for ${project}.`,
          ],
          detailRows: [
            { label: "Company", value: company },
            ...(jobReference ? [{ label: "Job", value: jobReference }] : []),
            {
              label: "Accepted value",
              value: String(metadata.acceptedValue ?? "See quote"),
            },
            {
              label: "Required date",
              value: String(metadata.requiredDate ?? "Not specified"),
            },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/admin/jobs/${metadata.jobId ?? ""}`)),
          footerNote: metadata.opportunityUrl
            ? `Opportunity: ${buildAbsoluteUrl(String(metadata.opportunityUrl))}`
            : undefined,
        }),
      };

    case "artwork_uploaded":
      return {
        subject: `Artwork uploaded — ${jobReference || project}`,
        html: renderEmailShell({
          headline: "Customer artwork uploaded",
          bodyParagraphs: [
            `${company} uploaded artwork for ${jobReference || project}.`,
          ],
          detailRows: [
            { label: "Customer", value: customerName },
            { label: "Job", value: jobReference || String(metadata.jobId ?? "") },
            {
              label: "Files",
              value: String(metadata.fileSummary ?? "Artwork uploaded"),
            },
          ],
          ctaLabel: "View job",
          ctaHref: buildAbsoluteUrl(String(metadata.jobUrl ?? `/admin/jobs/${metadata.jobId ?? ""}`)),
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
