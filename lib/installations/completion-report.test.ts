import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractPdfText } from "@/lib/materials/invoices/extract";
import {
  buildInstallationReportPath,
  checklistReportValues,
  formatInstallationReportReference,
  hasOfficialInstallationSignOff,
  installationReportScopeStatement,
  installationReportSnagStatement,
  quoteReferenceLabel,
  selectInstallationReportPhotos,
} from "@/lib/installations/completion-report";
import { buildInstallationCompletionReportPdf, type CompletionReportPdfInput } from "@/lib/installations/completion-report-pdf";
import { canManageInstallations, canOperateInstallations, canReadInstallations } from "@/lib/installations/permissions";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function report(overrides: Partial<CompletionReportPdfInput> = {}): CompletionReportPdfInput {
  return {
    reportReference: "ICR-J-7-V1.1",
    versionNumber: 1,
    generatedAtLabel: "10 Nov 2026, 18:00",
    jobReference: "J-7",
    quoteReference: "Q-7",
    companyName: "Northwind Displays",
    siteAddress: "1 Harbour Street, Bristol, BS1 4QT",
    installationDateLabel: "10 Nov 2026, 09:00",
    installers: ["Alex Installer"],
    visitStatusLabel: "Completed",
    visitTitle: "Shopfront signs",
    visitNumber: 1,
    projectStatusLabel: "Active",
    workDetails: [{ label: "Instructions", value: "Use the side entrance." }],
    checklist: {
      siteLeftSafeAndTidy: false,
      installationPhotosRecorded: false,
      recordedBy: null,
      recordedAtLabel: null,
    },
    snags: [],
    attendance: null,
    customerName: null,
    declineReason: null,
    signedAtLabel: null,
    signOffRecordedBy: null,
    signaturePng: null,
    photos: [],
    includeQuotationAppendix: false,
    ...overrides,
  };
}

async function textOf(input: CompletionReportPdfInput) {
  const bytes = await buildInstallationCompletionReportPdf(input);
  return { bytes, text: await extractPdfText(bytes) };
}

test("report references stay on the visit and do not invent a price", () => {
  assert.equal(formatInstallationReportReference("J-7", 1, 2), "ICR-J-7-V1.2");
  assert.equal(quoteReferenceLabel(7), "Q-7");
  assert.equal(quoteReferenceLabel(null), null);
  assert.match(installationReportScopeStatement(1, "Active"), /does not complete the installation project/);
  assert.match(installationReportSnagStatement(1, 2), /Outstanding snags remain/);
  assert.doesNotMatch(installationReportSnagStatement(1, 2), /snag-free/);
  assert.match(installationReportSnagStatement(0, 1), /No outstanding snags remain/);
  const values = checklistReportValues(null);
  assert.equal(values.siteLeftSafeAndTidy, false);
  assert.equal(values.installationPhotosRecorded, false);
});

test("deselecting a photograph leaves the original list intact", () => {
  const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const selected = selectInstallationReportPhotos(photos, ["b"]);
  assert.deepEqual(selected.map((photo) => photo.id), ["b"]);
  assert.equal(photos.length, 3);
  assert.deepEqual(selectInstallationReportPhotos(photos, null).map((photo) => photo.id), ["a", "b", "c"]);
});

test("an absent customer and a declined signature do not invent a signature", async () => {
  const absent = await textOf(report({ attendance: "absent" }));
  assert.match(absent.text, /Customer not present/);
  assert.match(absent.text, /no signature obtained/);
  assert.doesNotMatch(absent.text, /£|Subtotal|quotation appendix/i);

  const declined = await textOf(
    report({ attendance: "declined", declineReason: "The facilities manager refused." })
  );
  assert.match(declined.text, /Customer declined to sign/);
  assert.match(declined.text, /facilities manager refused/);
});

test("a present customer report includes the saved signature and checklist values", async () => {
  const { text } = await textOf(
    report({
      attendance: "present",
      customerName: "Ada Lovelace",
      signaturePng: PNG,
      signedAtLabel: "10 Nov 2026, 16:40",
      signOffRecordedBy: "Alex Installer",
      checklist: {
        siteLeftSafeAndTidy: true,
        installationPhotosRecorded: false,
        recordedBy: "Alex Installer",
        recordedAtLabel: "10 Nov 2026, 16:40",
      },
    })
  );
  assert.match(text, /Ada Lovelace/);
  assert.match(text, /Alex Installer/);
  assert.match(text, /Confirmed/);
  assert.match(text, /Not confirmed/);
  assert.match(text, /Site left safe and clean\/tidy/);
  assert.match(text, /Installation photos recorded/);
  assert.match(text, /Q-7/);
  assert.match(text, /J-7/);
  assert.match(text, /Visit status/);
  assert.match(text, /Completed/);
  assert.match(text, /Active/);
  assert.match(text, /does not complete the installation project/);
});

test("an official report requires a valid visit sign-off", () => {
  const checklist = { siteLeftSafeAndTidy: true, installationPhotosRecorded: true };
  assert.equal(hasOfficialInstallationSignOff(null), false);
  assert.equal(
    hasOfficialInstallationSignOff({
      customerAttendance: "present",
      customerName: "Ada Lovelace",
      signatureStoragePath: "visit/documents/other/signature.png",
      checklist,
    }),
    true
  );
  assert.equal(
    hasOfficialInstallationSignOff({
      customerAttendance: "present",
      customerName: "Ada Lovelace",
      signatureStoragePath: null,
      checklist,
    }),
    false
  );
  assert.equal(
    hasOfficialInstallationSignOff({
      customerAttendance: "absent",
      signatureStoragePath: null,
      checklist,
    }),
    true
  );
  assert.equal(
    hasOfficialInstallationSignOff({
      customerAttendance: "declined",
      declineReason: "The facilities manager refused.",
      signatureStoragePath: null,
      checklist,
    }),
    true
  );
  assert.equal(
    hasOfficialInstallationSignOff({
      customerAttendance: "declined",
      declineReason: "   ",
      signatureStoragePath: null,
      checklist,
    }),
    false
  );
  assert.equal(
    hasOfficialInstallationSignOff({
      customerAttendance: "absent",
      signatureStoragePath: null,
      checklist: null,
    }),
    false
  );
});

test("outstanding and resolved snags stay distinct across photograph pages", async () => {
  const photos = ["before", "during", "after"].flatMap((phase) =>
    [1, 2, 3].map((index) => ({
      id: `${phase}-${index}`,
      caption: `${phase} photograph ${index}`,
      bytes: PNG,
    }))
  );
  const { bytes, text } = await textOf(
    report({
      snags: [
        {
          description: "Scratch on the end cap",
          statusLabel: "Open",
          outstanding: true,
          assignee: "Sam Maker",
          resolutionNotes: null,
          issuePhotos: [{ id: "issue", caption: "Scratch close-up", bytes: PNG }],
          resolutionPhotos: [],
        },
        {
          description: "Loose bracket",
          statusLabel: "Resolved",
          outstanding: false,
          assignee: "Sam Maker",
          resolutionNotes: "Bracket tightened.",
          issuePhotos: [],
          resolutionPhotos: [{ id: "fixed", caption: "Bracket after repair", bytes: PNG }],
        },
      ],
      photos: [
        { phaseLabel: "Before installation", images: photos.filter((photo) => photo.id.startsWith("before")) },
        { phaseLabel: "During installation", images: photos.filter((photo) => photo.id.startsWith("during")) },
        { phaseLabel: "After installation", images: photos.filter((photo) => photo.id.startsWith("after")) },
      ],
    })
  );
  assert.match(text, /Outstanding snags remain/);
  assert.match(text, /Scratch on the end cap/);
  assert.match(text, /Loose bracket/);
  assert.match(text, /Bracket tightened/);
  assert.match(text, /Before installation/);
  assert.match(text, /During installation/);
  assert.match(text, /After installation/);
  assert.match(text, /Page 1 of /);
  assert.match(text, /Page 2 of /);
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 2);
});

test("a quotation appendix is reserved and excluded photographs stay out of the PDF", async () => {
  await assert.rejects(
    () =>
      buildInstallationCompletionReportPdf({
        ...report(),
        includeQuotationAppendix: true as unknown as false,
      }),
    /quotation appendix/
  );

  const included = await textOf(
    report({
      photos: [
        {
          phaseLabel: "Before installation",
          images: [{ id: "keep", caption: "Keep this elevation", bytes: PNG }],
        },
      ],
    })
  );
  assert.match(included.text, /Keep this elevation/);

  const excluded = await textOf(report({ photos: [] }));
  assert.match(excluded.text, /No installation photographs were selected/);
  assert.doesNotMatch(excluded.text, /Keep this elevation/);
});

test("completion report permissions and storage stay with managers", async () => {
  assert.equal(canManageInstallations({ account_status: "approved", user_role: "admin" }), true);
  assert.equal(canManageInstallations({ account_status: "approved", user_role: "production" }), false);
  assert.equal(canOperateInstallations({ account_status: "approved", user_role: "production" }), true);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "sales" }), true);
  assert.equal(canManageInstallations({ account_status: "approved", user_role: "sales" }), false);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "customer" }), false);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "accounts" }), false);

  const route = await readFile(
    new URL("../../app/api/admin/installations/visits/[visitId]/completion-report/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /canManageInstallations/);
  assert.match(route, /assertVisitReadyForOfficialReport/);
  assert.ok(route.indexOf("if (!persist)") < route.indexOf("await assertVisitReadyForOfficialReport"));
  assert.match(route, /export const runtime = "nodejs"/);
  assert.doesNotMatch(route, /canOperateInstallations/);
  const nextConfig = await readFile(new URL("../../next.config.ts", import.meta.url), "utf8");
  assert.match(nextConfig, /\/api\/admin\/installations\/visits\/\[visitId\]\/completion-report/);
  assert.match(nextConfig, /completionReportTracingIncludes[\s\S]*libvips-cpp\.so\.8\.18\.3/);
  assert.match(nextConfig, /completionReportTracingIncludes[\s\S]*LOGO_YELLOW\.png/);
  const screen = await readFile(
    new URL("../../components/installations/installation-completion-report.tsx", import.meta.url),
    "utf8"
  );
  assert.match(screen, /canSaveOfficialReport/);
  assert.doesNotMatch(screen, /storage\.remove|\.delete\(/);
  const sql = await readFile(
    new URL("../../supabase/migrations/20270110174000_installation_completion_reports.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /installation_assert_manager/);
  assert.match(sql, /Record the visit sign-off before saving the completion report/);
  assert.match(sql, /customer_attendance = 'present'/);
  assert.match(sql, /customer_attendance = 'absent'/);
  assert.match(sql, /customer_attendance = 'declined'/);
  assert.match(sql, /installation_completion_reports_visit_version_key/);
  assert.match(sql, /append-only/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /installation_files_select_report_manager/);
  assert.doesNotMatch(sql, /UPDATE public\.installation_projects/);
  assert.doesNotMatch(sql, /UPDATE public\.jobs/);
  assert.match(buildInstallationReportPath("visit", 2, "ICR-J-7-V1.2"), /\/reports\/v2\/ICR-J-7-V1\.2\.pdf$/);
});
