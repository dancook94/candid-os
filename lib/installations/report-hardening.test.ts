import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { INSTALLATION_REPORT_EMAIL_ATTACHMENT_MAX_BYTES } from "@/lib/installations/report-constants";
import { INSTALLATION_REPORT_MANAGER_SEND_BYPASSES_CONTACT_PREFERENCE } from "@/lib/installations/report-delivery-policy";
import { CUSTOMER_TYPE_PREFERENCE_KEY } from "@/lib/notifications/notification-types";
import { NOTIFICATION_PREFERENCE_KEYS } from "@/lib/customer-settings/permissions";

test("installation reports use a dedicated customer preference", () => {
  assert.equal(CUSTOMER_TYPE_PREFERENCE_KEY.installation_report_available, "installation_reports");
  assert.notEqual(CUSTOMER_TYPE_PREFERENCE_KEY.installation_report_available, "job_ready");
  assert.ok(NOTIFICATION_PREFERENCE_KEYS.includes("installation_reports"));
});

test("manager installation report sends bypass contact opt-out", () => {
  assert.equal(INSTALLATION_REPORT_MANAGER_SEND_BYPASSES_CONTACT_PREFERENCE, true);
});

test("customer report downloads stream through the authenticated route", async () => {
  const route = await readFile(
    new URL("../../app/api/customer/jobs/[id]/installation-reports/[reportId]/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /downloadCustomerPublishedReportBytes/);
  assert.match(route, /inlineReportResponse/);
  assert.doesNotMatch(route, /signedCustomerPublishedReportUrl/);
  assert.doesNotMatch(route, /NextResponse\.redirect/);
});

test("email attachment limit stays below provider maximum", () => {
  assert.ok(INSTALLATION_REPORT_EMAIL_ATTACHMENT_MAX_BYTES <= 25_000_000);
  assert.ok(INSTALLATION_REPORT_EMAIL_ATTACHMENT_MAX_BYTES >= 4_000_000);
});
