import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function readRepoFile(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("app shell navigation", () => {
  it("1. desktop sidebar remains desktop-only with viewport scroll fix", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /hidden h-dvh max-h-dvh w-\[17\.5rem\].*lg:flex/s);
    assert.match(source, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  });

  it("2. mobile menu trigger exists below desktop breakpoint", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /aria-label="Open navigation menu"/);
    assert.match(source, /setMobileNavOpen\(true\)/);
    assert.match(source, /<Menu className="h-5 w-5"/);
    assert.match(source, /lg:hidden/);
  });

  it("3. mobile drawer reuses role-filtered navigation links", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /function NavLinksList/);
    assert.match(source, /links={linksWithBadges}/);
    assert.match(source, /userRole === "admin"/);
    assert.match(source, /customerLinks/);
    assert.match(source, /staffLinks/);
  });

  it("4. mobile drawer includes scrollable nav and fixed account footer", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /id="mobile-navigation-menu"/);
    assert.match(source, /aria-label="Navigation menu"/);
    assert.match(source, /function SidebarAccountFooter/);
    assert.match(source, /onNavigate={closeMobileNav}/);
    assert.match(source, /Sign out/);
  });

  it("5. updates unread badge is shared between desktop and mobile nav", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /updatesUnreadCount/);
    assert.match(source, /badgeCount/);
    assert.match(source, /NavLinksList[\s\S]*badgeCount/s);
  });

  it("6. mobile menu closes on navigation, backdrop, and Escape", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /closeMobileNav/);
    assert.match(source, /onNavigate={closeMobileNav}/);
    assert.match(source, /aria-label="Close navigation menu"/);
    assert.match(source, /event.key === "Escape"/);
    assert.match(source, /\[pathname, closeMobileNav\]/);
  });

  it("7. active route styling is shared via isNavLinkActive", async () => {
    const source = await readRepoFile("components/app-shell.tsx");

    assert.match(source, /function isNavLinkActive/);
    assert.match(source, /before:bg-\[var\(--candid-yellow\)\]/);
  });
});
