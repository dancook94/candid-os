import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { installationReportDeliveryIdempotencyKey } from "@/lib/installations/report-delivery";
import { isReportCurrentlyPublished } from "@/lib/installations/report-publication";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110175000_installation_report_customer_delivery.sql",
  import.meta.url
);
const PREFERENCE_MIGRATION = new URL(
  "../../supabase/migrations/20270110176000_installation_reports_notification_preference.sql",
  import.meta.url
);

test("publication migration keeps saved reports immutable and manager-only", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const preferenceSql = await readFile(PREFERENCE_MIGRATION, "utf8");
  assert.match(preferenceSql, /installation_reports boolean NOT NULL DEFAULT true/);
  assert.match(sql, /installation_visit_published_reports/);
  assert.match(sql, /installation_completion_report_publication_events/);
  assert.match(sql, /installation_completion_report_deliveries/);
  assert.match(sql, /installation_publish_completion_report/);
  assert.match(sql, /installation_unpublish_completion_report/);
  assert.ok(
    sql.indexOf("installation_assert_manager()") <
      sql.indexOf("INSERT INTO public.installation_visit_published_reports")
  );
  assert.match(sql, /installation_block_client_table_writes/);
});

test("isReportCurrentlyPublished only matches the active published report", () => {
  const publication = {
    reportId: "report-b",
    publishedAt: "2026-11-10T00:00:00.000Z",
    publishedByProfileId: "manager",
    publishedByName: "Manager",
  };

  assert.equal(isReportCurrentlyPublished("report-b", publication), true);
  assert.equal(isReportCurrentlyPublished("report-a", publication), false);
});

test("delivery idempotency keys allow deliberate resends", () => {
  const base = installationReportDeliveryIdempotencyKey("report-1", "Customer@Example.com", false);
  const resend = installationReportDeliveryIdempotencyKey("report-1", "customer@example.com", true);
  assert.equal(base, "installation_report_email:report-1:customer@example.com");
  assert.match(resend, /^installation_report_email:report-1:customer@example.com:\d+$/);
  assert.notEqual(base, resend);
});
