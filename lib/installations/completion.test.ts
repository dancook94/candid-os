import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { completionIssues } from "@/lib/installations/completion";
import { canOperateInstallations, canReadInstallations, canManageInstallations } from "@/lib/installations/permissions";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110173000_installation_sign_off_checklist.sql",
  import.meta.url
);

const checked = [true, true] as const;

test("completion allows absence and a declined signature without a drawing", () => {
  const absent = completionIssues({
    checklist: checked,
    attendance: "absent",
    customerName: "",
    signaturePresent: false,
    declineReason: "",
    outstandingSnags: 0,
  });
  assert.equal(absent.canSave, true);

  const declined = completionIssues({
    checklist: checked,
    attendance: "declined",
    customerName: "",
    signaturePresent: false,
    declineReason: "Customer refused at the door",
    outstandingSnags: 1,
  });
  assert.equal(declined.canSave, true);
  assert.match(declined.warnings[0], /outstanding snag/);

  const missingReason = completionIssues({
    checklist: checked,
    attendance: "declined",
    customerName: "",
    signaturePresent: false,
    declineReason: " ",
    outstandingSnags: 0,
  });
  assert.equal(missingReason.canSave, false);
});

test("a present customer needs a name and a handwritten signature", () => {
  const missing = completionIssues({
    checklist: checked,
    attendance: "present",
    customerName: "Ada",
    signaturePresent: false,
    declineReason: "",
    outstandingSnags: 0,
  });
  assert.equal(missing.canSave, false);
  assert.match(missing.errors.join(" "), /handwritten signature/);

  const ready = completionIssues({
    checklist: [true, false],
    attendance: "present",
    customerName: "Ada",
    signaturePresent: true,
    declineReason: "",
    outstandingSnags: 0,
  });
  assert.equal(ready.canSave, false);
  assert.match(ready.errors.join(" "), /checklist/);
});

test("sign-off migration records attendance from the authenticated session", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /p_customer_attendance = 'present'/);
  assert.match(sql, /p_customer_attendance = 'absent'/);
  assert.match(sql, /p_customer_attendance = 'declined'/);
  assert.match(sql, /captured_by_profile_id/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /Sign-off already recorded for this visit/);
  assert.match(sql, /A handwritten signature is required when the customer is present/);
  assert.match(sql, /Customer not present/);
  assert.match(sql, /Explain why the customer declined to sign/);
  assert.match(sql, /site_left_safe_and_tidy/);
  assert.match(sql, /installation_photos_recorded/);
  assert.match(sql, /confirmed_by_profile_id', auth\.uid\(\)/);
  assert.match(sql, /installation_files_delete_manager/);
  assert.match(sql, /installation_files_delete_unlinked_signature/);
  assert.match(sql, /customer-signature\.png/);
  assert.match(sql, /signature_storage_path = name/);
  assert.doesNotMatch(sql, /DELETE FROM storage\.objects/);
  assert.doesNotMatch(sql, /UPDATE public\.installation_projects/);
  assert.doesNotMatch(sql, /GRANT INSERT/i);
  assert.doesNotMatch(sql, /TO anon/i);
});

test("installation tabs keep scheduling with managers and sign-off separate from the project", async () => {
  const panel = await readFile(
    new URL("../../components/installations/installation-project-panel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /Visit Details/);
  assert.match(panel, /Completion & Sign-off/);
  assert.match(panel, /InstallationSignaturePad/);
  assert.match(panel, /p_checklist/);
  assert.match(panel, /customer-signature\.png/);
  assert.match(panel, /\.remove\(\[storagePath\]\)/);
  assert.match(panel, /Checklist confirmed by/);
  assert.match(panel, /Customer not present/);
  assert.match(panel, /Customer declined to sign/);
  assert.match(panel, /does not complete the installation project/);
  const details = panel.slice(panel.indexOf('tab === "details"'), panel.indexOf('tab === "photos"'));
  assert.match(details, /ScheduleForm/);
  assert.match(details, /canManage/);
  assert.doesNotMatch(panel.slice(panel.indexOf("function SignOffForm")), /installation_project_update_details/);

  const pad = await readFile(
    new URL("../../components/installations/installation-signature-pad.tsx", import.meta.url),
    "utf8"
  );
  assert.match(pad, /from "signature_pad"/);
  assert.match(pad, /touchAction: "none"/);
  assert.match(pad, /Clear Signature/);

  assert.equal(canManageInstallations({ account_status: "approved", user_role: "production" }), false);
  assert.equal(canOperateInstallations({ account_status: "approved", user_role: "production" }), true);
  assert.equal(canManageInstallations({ account_status: "approved", user_role: "sales" }), false);
  assert.equal(canOperateInstallations({ account_status: "approved", user_role: "sales" }), false);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "sales" }), true);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "customer" }), false);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "accounts" }), false);
});
