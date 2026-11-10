import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isValidInstallationStoragePath,
  buildInstallationPhotoPath,
} from "@/lib/installations/storage";

const HARDENING = new URL(
  "../../supabase/migrations/20270110164000_installation_phase1_hardening.sql",
  import.meta.url
);

test("storage paths must include documents or photos segment", () => {
  const visitId = "8d4f4b4a-1111-4222-8333-444444444444";
  const good = buildInstallationPhotoPath(visitId, "before", "a.jpg");
  assert.equal(isValidInstallationStoragePath(good, visitId), true);
  assert.equal(
    isValidInstallationStoragePath(`${visitId}/orphan/a.jpg`, visitId),
    false
  );
});

test("hardening migration binds storage to existing visits", async () => {
  const sql = await readFile(HARDENING, "utf8");
  assert.match(sql, /installation_visit_exists/);
  assert.match(sql, /installation_storage_path_is_valid/);
});

test("hardening migration protects terminal visits and adds manager reopen", async () => {
  const sql = await readFile(HARDENING, "utf8");
  assert.match(sql, /Completed or cancelled visits cannot be changed/);
  assert.match(sql, /installation_visit_manager_reopen/);
  assert.match(sql, /visit_reopened/);
});
