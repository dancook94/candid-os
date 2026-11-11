import assert from "node:assert/strict";
import test from "node:test";

import { renderInstallationReportEmail } from "@/lib/installations/report-delivery-email";

test("installation report email uses the customer portal link", () => {
  const rendered = renderInstallationReportEmail({
    customerName: "Sam",
    companyName: "Example Ltd",
    jobReference: "J-7",
    projectName: "Window vinyls",
    reportReference: "ICR-J-7-V1.2",
    visitNumber: 1,
    visitTitle: "Initial site visit",
    portalUrl: "/jobs/job-1#installation-report-report-1",
    customerMessage: "Please review the completed installation.",
  });

  assert.match(rendered.subject, /ICR-J-7-V1\.2/);
  assert.match(rendered.html, /View installation report/);
  assert.match(rendered.html, /jobs\/job-1/);
  assert.match(rendered.html, /Please review the completed installation/);
});
