import { renderEmailShell, buildAbsoluteUrl } from "@/lib/notifications/templates";

export function renderInstallationReportEmail(input: {
  customerName: string;
  companyName: string;
  jobReference: string;
  projectName: string;
  reportReference: string;
  visitNumber: number;
  visitTitle: string;
  portalUrl: string;
  customerMessage?: string | null;
}) {
  const subject = `Installation report ${input.reportReference} — ${input.jobReference || input.projectName}`;
  const html = renderEmailShell({
    preheader: `Your installation report for ${input.projectName} is ready to view.`,
    headline: "Your installation report is ready",
    bodyParagraphs: [
      `Hi ${input.customerName},`,
      `We've published an installation completion report for ${input.projectName}. You can review it securely in your Candid OS portal.`,
      ...(input.customerMessage?.trim() ? [input.customerMessage.trim()] : []),
    ],
    detailRows: [
      { label: "Job", value: input.jobReference || "—" },
      { label: "Project", value: input.projectName },
      { label: "Visit", value: `Visit ${input.visitNumber}: ${input.visitTitle}` },
      { label: "Report", value: input.reportReference },
    ],
    ctaLabel: "View installation report",
    ctaHref: buildAbsoluteUrl(input.portalUrl),
  });

  return { subject, html };
}
