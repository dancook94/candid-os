import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deriveInstallationJobSignal,
  installationCardText,
  isOutstandingInstallationSnag,
} from "@/lib/installations/job-signal";
import { canReadInstallations } from "@/lib/installations/permissions";

const UX = new URL(
  "../../supabase/migrations/20270110171000_installation_ux_permissions.sql",
  import.meta.url
);

const line = {
  isOptional: false,
  isSelected: true,
  requiresPrintSupply: false,
  requiresDelivery: false,
  requiresInstallation: false,
  workClass: null as string | null,
  title: "Site installation",
};

test("installation indicator uses explicit classification and ignores titles", () => {
  const titled = deriveInstallationJobSignal({
    lines: [line],
    projectId: null,
    visits: [],
    canReadInstallations: true,
  });
  assert.equal(titled.required, false);
  assert.equal(titled.missingProject, false);
  assert.equal(installationCardText(titled), null);

  const classified = deriveInstallationJobSignal({
    lines: [{ ...line, requiresInstallation: true, title: "Vinyl" }],
    projectId: null,
    visits: [{ status: "unscheduled", scheduledStartAt: null }],
    canReadInstallations: true,
  });
  assert.equal(classified.required, true);
  assert.equal(classified.scheduleLabel, null);
  assert.equal(classified.missingProject, true);
  assert.equal(installationCardText(classified), "INSTALL");

  const legacy = deriveInstallationJobSignal({
    lines: [{ ...line, workClass: "installation" }],
    projectId: null,
    visits: [],
    canReadInstallations: true,
  });
  assert.equal(legacy.required, true);

  const printAndDelivery = deriveInstallationJobSignal({
    lines: [{ ...line, requiresPrintSupply: true, requiresDelivery: true, title: "Install" }],
    projectId: null,
    visits: [],
    canReadInstallations: true,
  });
  assert.equal(printAndDelivery.required, false);

  const optional = deriveInstallationJobSignal({
    lines: [{ ...line, isOptional: true, isSelected: false, requiresInstallation: true }],
    projectId: null,
    visits: [],
    canReadInstallations: true,
  });
  assert.equal(optional.required, false);
});

test("production board label shows the scheduled date or not scheduled", () => {
  const unscheduled = deriveInstallationJobSignal({
    lines: [{ ...line, requiresInstallation: true }],
    projectId: "project-1",
    visits: [{ status: "unscheduled", scheduledStartAt: null }],
    canReadInstallations: true,
  });
  assert.equal(unscheduled.scheduleLabel, "Not scheduled");
  assert.equal(installationCardText(unscheduled), "INSTALL · Not scheduled");
  assert.equal(unscheduled.showManagementLink, true);

  const scheduled = deriveInstallationJobSignal({
    lines: [],
    projectId: "project-1",
    visits: [{ status: "scheduled", scheduledStartAt: "2026-11-18T09:00:00.000Z" }],
    canReadInstallations: true,
  });
  assert.match(installationCardText(scheduled) || "", /INSTALL · 18 Nov 2026/);
});

test("installation management links stay hidden from customers and unauthorised roles", () => {
  assert.equal(
    canReadInstallations({ account_status: "approved", user_role: "customer" }),
    false
  );
  assert.equal(
    canReadInstallations({ account_status: "approved", user_role: "accounts" }),
    false
  );
  const hidden = deriveInstallationJobSignal({
    lines: [{ ...line, requiresInstallation: true }],
    projectId: "project-1",
    visits: [],
    canReadInstallations: false,
  });
  assert.equal(hidden.required, true);
  assert.equal(hidden.showManagementLink, false);
  assert.equal(hidden.missingProject, false);
});

test("outstanding snags include open and in progress", () => {
  assert.equal(isOutstandingInstallationSnag("open"), true);
  assert.equal(isOutstandingInstallationSnag("in_progress"), true);
  assert.equal(isOutstandingInstallationSnag("resolved"), false);
});

test("photo permission migration grants only the storage helpers to authenticated", async () => {
  const sql = await readFile(UX, "utf8");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.installation_visit_exists\(uuid\) TO authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.installation_storage_path_is_valid\(text\) TO authenticated;/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.installation_storage_visit_id_from_path\(text\) TO authenticated;/
  );
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.installation_storage_path_is_valid\(text\) TO service_role;/);
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.installation_visit_exists\(uuid\) TO service_role;/
  );
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.installation_visit_exists\(uuid\) FROM PUBLIC, anon;/);
  assert.doesNotMatch(sql, /TO anon/i);
  assert.doesNotMatch(sql, /GRANT ALL/i);
  assert.doesNotMatch(sql, /GRANT INSERT/i);
  assert.match(sql, /'in_progress'/);
  assert.match(sql, /assigned_to_profile_id/);
  assert.match(sql, /snag_photo_role IN \('issue', 'resolution'\)/);
  assert.match(sql, /installation_register_snag_photo/);
  assert.doesNotMatch(sql, /UPDATE public\.installation_projects/);
});

test("project page keeps sign-off separate from project completion", async () => {
  const panel = await readFile(
    new URL("../../components/installations/installation-project-panel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(panel, /Completion checklist/);
  assert.match(panel, /Customer signature/);
  assert.match(panel, /installation_sign_off_capture/);
  assert.match(panel, /does not complete the installation project/);
  assert.match(panel, /outstanding snag/);
  const signOff = panel.slice(panel.indexOf("function SignOffForm"));
  assert.doesNotMatch(signOff, /installation_project_update_details/);
  assert.doesNotMatch(signOff, /installation_visit_operational_progress/);

  const customer = await readFile(
    new URL("../../components/customer-jobs-list.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(customer, /Requires Installation/);
  assert.doesNotMatch(customer, /\/admin\/installations/);

  const jobPage = await readFile(
    new URL("../../app/admin/jobs/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(jobPage, /Requires Installation/);
  assert.match(jobPage, /canReadInstallations/);

  const card = await readFile(
    new URL("../../components/production/job-production-board-card.tsx", import.meta.url),
    "utf8"
  );
  assert.match(card, /installation_label/);
});
