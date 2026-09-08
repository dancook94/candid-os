export type IntendedRecipient = {
  role: "to" | "cc" | "bcc";
  address: string;
};

function formatRecipientLine(recipient: IntendedRecipient): string {
  return `${recipient.role.toUpperCase()}: ${recipient.address}`;
}

export function buildTestEmailSubject(originalSubject: string): string {
  return `[TEST] ${originalSubject}`;
}

export function buildTestEmailPlainBanner(
  intendedRecipients: IntendedRecipient[]
): string {
  const lines = [
    "TEST EMAIL — CUSTOMER NOT CONTACTED",
    "",
    "Intended recipient(s):",
    ...intendedRecipients.map((recipient) => formatRecipientLine(recipient)),
    "",
    "---",
    "",
  ];

  return lines.join("\n");
}

export function buildTestEmailHtmlBanner(
  intendedRecipients: IntendedRecipient[]
): string {
  const recipientRows = intendedRecipients
    .map(
      (recipient) =>
        `<li><strong>${recipient.role.toUpperCase()}:</strong> ${escapeHtml(recipient.address)}</li>`
    )
    .join("");

  return `
<div style="margin:0 0 24px;padding:16px 20px;border:2px solid #b45309;background:#fffbeb;color:#78350f;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;border-radius:8px;">
  <p style="margin:0 0 8px;font-weight:700;font-size:15px;">TEST EMAIL — CUSTOMER NOT CONTACTED</p>
  <p style="margin:0 0 8px;">Intended recipient(s):</p>
  <ul style="margin:0;padding-left:20px;">${recipientRows}</ul>
</div>`.trim();
}

export function wrapHtmlWithTestBanner(
  html: string,
  intendedRecipients: IntendedRecipient[]
): string {
  const banner = buildTestEmailHtmlBanner(intendedRecipients);
  return `${banner}${html}`;
}

export function wrapPlainTextWithTestBanner(
  text: string,
  intendedRecipients: IntendedRecipient[]
): string {
  return `${buildTestEmailPlainBanner(intendedRecipients)}${text}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
