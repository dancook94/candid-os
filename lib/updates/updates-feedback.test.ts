import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  audienceMatchesUserRole,
  isProblemReportPriority,
  isProblemReportStatus,
  isProductUpdateAudience,
} from "@/lib/updates/types";
import { sanitizePublicUpdatePrefillFromReport } from "@/lib/updates/admin";
import {
  validateProblemReportAttachmentFile,
  PROBLEM_REPORT_ATTACHMENT_ACCEPT,
} from "@/lib/problem-reports/attachments";
import {
  validateProblemReportSubmission,
  validateProblemReportAdminUpdate,
} from "@/lib/problem-reports/queries";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("product update visibility", () => {
  it("1. customers see everyone and customer audiences", () => {
    assert.equal(audienceMatchesUserRole("everyone", "customer"), true);
    assert.equal(audienceMatchesUserRole("customers", "customer"), true);
    assert.equal(audienceMatchesUserRole("staff", "customer"), false);
  });

  it("2. staff see everyone and staff audiences", () => {
    assert.equal(audienceMatchesUserRole("everyone", "admin"), true);
    assert.equal(audienceMatchesUserRole("staff", "admin"), true);
    assert.equal(audienceMatchesUserRole("customers", "admin"), false);
    assert.equal(audienceMatchesUserRole("staff", "sales"), true);
  });

  it("3. unpublished updates are excluded from public fetch queries", async () => {
    const source = await readRepoFile("lib/updates/queries.ts");

    assert.match(source, /eq\("is_published", true\)/);
    assert.match(source, /includeUnpublished/);
  });

  it("4. unread count respects audience before counting reads", async () => {
    const source = await readRepoFile("lib/updates/queries.ts");

    assert.match(source, /audienceMatchesUserRole/);
    assert.match(source, /fetchVisibleProductUpdates/);
  });
});

describe("problem report security", () => {
  it("6. customer report listing is scoped to reporter", async () => {
    const source = await readRepoFile("lib/problem-reports/queries.ts");

    assert.match(source, /eq\("reporter_id", reporterId\)/);
  });

  it("7. admin report listing uses admin auth at route level", async () => {
    const source = await readRepoFile("app/api/admin/problem-reports/[id]/route.ts");

    assert.match(source, /verifyApprovedAdmin/);
  });

  it("9. reporter identity is server-derived in submit route", async () => {
    const source = await readRepoFile("app/api/problem-reports/route.ts");

    assert.match(source, /resolveReporterContext/);
    assert.match(source, /createAdminClient/);
    assert.match(source, /createProblemReport\(adminClient/);
    assert.doesNotMatch(source, /body\.reporterId|body\.reporter_role|body\.companyId/);
  });

  it("direct authenticated inserts are not allowed for problem reports", async () => {
    const migrationSource = await readRepoFile(
      "supabase/migrations/20260908143000_updates_feedback_foundation.sql"
    );
    const routeSource = await readRepoFile("app/api/problem-reports/route.ts");

    assert.doesNotMatch(migrationSource, /CREATE POLICY problem_reports_insert_own/);
    assert.match(migrationSource, /server-mediated via the service role/);
    assert.match(routeSource, /createAdminClient/);
  });

  it("8. ordinary staff cannot manage all reports without admin auth", async () => {
    const adminListSource = await readRepoFile("app/admin/problem-reports/page.tsx");
    const migrationSource = await readRepoFile(
      "supabase/migrations/20260908143000_updates_feedback_foundation.sql"
    );

    assert.match(adminListSource, /requireAdminPageAccess/);
    assert.match(migrationSource, /problem_reports_select_admin/);
    assert.match(migrationSource, /problem_reports_select_own/);
  });
});

describe("attachments", () => {
  it("10. rejects unsupported attachment types", () => {
    const invalidFile = {
      name: "malware.exe",
      type: "application/octet-stream",
      size: 1024,
    } as File;

    assert.match(
      validateProblemReportAttachmentFile(invalidFile) ?? "",
      /PNG, JPG, JPEG, or PDF/i
    );
  });

  it("11. attachment access is authenticated via API route", async () => {
    const source = await readRepoFile("app/api/problem-reports/[id]/attachment/route.ts");

    assert.match(source, /canAccessReport/);
    assert.doesNotMatch(source, /publicUrl|getPublicUrl/);
  });

  it("12. admin attachment route checks admin or ownership", async () => {
    const source = await readRepoFile("app/api/problem-reports/[id]/attachment/route.ts");

    assert.match(source, /verifyApprovedAdmin/);
    assert.match(source, /reporter_id === userId/);
  });

  it("accept string documents allowed upload types", () => {
    assert.match(PROBLEM_REPORT_ATTACHMENT_ACCEPT, /pdf/);
    assert.match(PROBLEM_REPORT_ATTACHMENT_ACCEPT, /png/);
  });
});

describe("validation", () => {
  it("13. report status validation rejects unknown values", () => {
    assert.equal(isProblemReportStatus("reported"), true);
    assert.equal(isProblemReportStatus("invalid"), false);
    assert.equal(
      validateProblemReportAdminUpdate({ status: "invalid" }).ok,
      false
    );
  });

  it("14. priority validation rejects unknown values", () => {
    assert.equal(isProblemReportPriority("minor"), true);
    assert.equal(isProblemReportPriority("blocking"), true);
    assert.equal(isProblemReportPriority("urgent"), false);
    assert.equal(
      validateProblemReportSubmission({ description: "Broken", priority: "urgent" }).ok,
      false
    );
  });
});

describe("fixed to create update workflow", () => {
  it("15. prefill does not leak reporter private details", () => {
    const prefill = sanitizePublicUpdatePrefillFromReport();

    assert.equal(prefill.title, "Issue resolved");
    assert.doesNotMatch(prefill.body, /reporter|email|company|screenshot/i);
    assert.equal(prefill.category, "fix");
  });

  it("admin create-from-report route uses safe prefill only", async () => {
    const source = await readRepoFile("app/admin/updates/new/page.tsx");

    assert.match(source, /sanitizePublicUpdatePrefillFromReport/);
    assert.doesNotMatch(source, /report\.description|report\.reporter_email/);
  });
});

describe("migration storage path security", () => {
  it("validates UUID format before casting storage path segment", async () => {
    const source = await readRepoFile(
      "supabase/migrations/20260908143000_updates_feedback_foundation.sql"
    );

    assert.match(source, /storage_problem_report_id_from_path/);
    assert.match(source, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
    assert.match(source, /RETURN NULL/);
    assert.doesNotMatch(
      source,
      /NULLIF\(split_part\(path, '\/', 1\), ''\)::uuid/
    );
  });

  it("handles empty and malformed paths without throwing in policy context", async () => {
    const source = await readRepoFile(
      "supabase/migrations/20260908143000_updates_feedback_foundation.sql"
    );

    assert.match(source, /IF path IS NULL OR btrim\(path\) = '' THEN/);
    assert.match(source, /IF segment IS NULL OR btrim\(segment\) = '' THEN/);
  });

  it("revokes public execute on security helper functions", async () => {
    const source = await readRepoFile(
      "supabase/migrations/20260908143000_updates_feedback_foundation.sql"
    );

    assert.match(source, /REVOKE ALL ON FUNCTION public.is_approved_staff\(\) FROM PUBLIC/);
    assert.match(
      source,
      /REVOKE ALL ON FUNCTION public.storage_problem_report_id_from_path\(text\) FROM PUBLIC/
    );
  });
});

describe("navigation and unread badge", () => {
  it("adds Updates to customer, staff and admin navigation", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /href: "\/updates"/);
    assert.match(source, /updatesUnreadCount/);
    assert.match(source, /badgeCount/);
  });

  it("5. read records are scoped to current user in migration", async () => {
    const source = await readRepoFile(
      "supabase/migrations/20260908143000_updates_feedback_foundation.sql"
    );

    assert.match(source, /product_update_reads/);
    assert.match(source, /user_id = auth.uid\(\)/);
  });
});

describe("existing safety regressions", () => {
  it("16. registration safety tests remain present", async () => {
    const source = await readRepoFile("lib/auth/public-registration.test.ts");
    assert.match(source, /public registration config/);
  });

  it("17. communication safety tests remain present", async () => {
    const source = await readRepoFile("lib/communications/communication-safety.test.ts");
    assert.match(source, /communication safety/);
  });

  it("18. staff auth tests remain present", async () => {
    const source = await readRepoFile("lib/staff-auth-actions.test.ts");
    assert.match(source, /staff auth action eligibility/);
  });

  it("19. quote tests remain present", async () => {
    const source = await readRepoFile("lib/quotes/send-quote.test.ts");
    assert.match(source, /send quote architecture/);
  });

  it("20. PDF tests remain present", async () => {
    const source = await readRepoFile("lib/quotes/quote-pdf.test.ts");
    assert.match(source, /quote PDF download/);
  });

  it("problem reports do not use customer Resend notifications", async () => {
    const source = await readRepoFile("lib/problem-reports/queries.ts");
    assert.doesNotMatch(source, /sendNotification|applyCommunicationSafety/);
  });

  it("audience enum is validated", () => {
    assert.equal(isProductUpdateAudience("everyone"), true);
    assert.equal(isProductUpdateAudience("partners"), false);
  });
});
