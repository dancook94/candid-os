import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function readRepoFile(path: string) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("staff leave navigation", () => {
  it("exposes staff and admin holiday routes in the app shell", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /href: "\/staff\/leave"/);
    assert.match(source, /href: "\/admin\/leave"/);
    assert.match(source, /leavePendingCount/);
  });

  it("defines stable page path constants", async () => {
    const source = await readRepoFile("lib/staff-leave/page-access.ts");

    assert.match(source, /STAFF_LEAVE_PATH = "\/staff\/leave"/);
    assert.match(source, /ADMIN_LEAVE_PATH = "\/admin\/leave"/);
    assert.match(source, /ADMIN_LEAVE_SICKNESS_PATH/);
  });
});
