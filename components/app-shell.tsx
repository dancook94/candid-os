"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CheckSquare,
  ClipboardList,
  Factory,
  FileText,
  Gauge,
  History,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Package,
  Receipt,
  Settings,
  Target,
  UserCog,
  Users,
  X,
} from "lucide-react";

import {
  GlobalSearch,
  GlobalSearchTrigger,
  useGlobalSearchShortcut,
} from "@/components/global-search";
import { CommunicationModeBanner } from "@/components/communication-mode-banner";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { getCustomerPortalStatusSubtitle } from "@/lib/customer-portal-status";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  userRole?: "customer" | "admin" | "staff";
  showStaffNav?: boolean;
  showCrmNav?: boolean;
  showGlobalSearch?: boolean;
  updatesUnreadCount?: number;
  userName?: string;
  companyName?: string;
  companyLogoUrl?: string | null;
  accountStatusSubtitle?: string;
  userAvatarUrl?: string | null;
};

type NavLink = {
  href: string;
  label: string;
  icon: typeof Gauge;
  badgeCount?: number;
};

const updatesLink: NavLink = {
  href: "/updates",
  label: "Updates",
  icon: Megaphone,
};

const customerLinks: NavLink[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: Gauge,
  },
  {
    href: "/quotes",
    label: "Quotes",
    icon: FileText,
  },
  {
    href: "/jobs",
    label: "Jobs",
    icon: Package,
  },
  updatesLink,
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
  },
];

const adminLinks: NavLink[] = [
  {
    href: "/admin",
    label: "Admin dashboard",
    icon: Gauge,
  },
  {
    href: "/admin/customers",
    label: "Contacts",
    icon: Users,
  },
  {
    href: "/admin/companies",
    label: "Companies",
    icon: Building2,
  },
  {
    href: "/admin/quote-requests",
    label: "Quote requests",
    icon: ClipboardList,
  },
  {
    href: "/admin/quotes",
    label: "Quotes",
    icon: FileText,
  },
  {
    href: "/admin/jobs",
    label: "Jobs",
    icon: Package,
  },
  updatesLink,
  {
    href: "/admin/updates",
    label: "Manage updates",
    icon: FileText,
  },
  {
    href: "/admin/problem-reports",
    label: "Problem reports",
    icon: ClipboardList,
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
  },
];

const crmLinks: NavLink[] = [
  {
    href: "/admin/production",
    label: "Production Board",
    icon: Factory,
  },
  {
    href: "/admin/invoices",
    label: "Invoices",
    icon: Receipt,
  },
  {
    href: "/admin/opportunities",
    label: "Opportunities",
    icon: Target,
  },
  {
    href: "/admin/tasks",
    label: "Tasks",
    icon: CheckSquare,
  },
  {
    href: "/admin/activity",
    label: "Activity",
    icon: History,
  },
  {
    href: "/admin/notifications",
    label: "Notifications",
    icon: Mail,
  },
];

const staffManagementLink: NavLink = {
  href: "/admin/staff",
  label: "Staff",
  icon: UserCog,
};

const staffLinks: NavLink[] = [
  {
    href: "/staff",
    label: "Workspace",
    icon: Gauge,
  },
  updatesLink,
];

function assertUniqueNavHrefs(links: NavLink[], context: string) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const seen = new Map<string, string>();

  for (const link of links) {
    const existingLabel = seen.get(link.href);

    if (existingLabel) {
      console.warn(
        `[AppShell] Duplicate navigation href "${link.href}" (${existingLabel} and ${link.label}) in ${context}.`
      );
    } else {
      seen.set(link.href, link.label);
    }
  }
}

function isNavLinkActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== "/admin" &&
      href !== "/dashboard" &&
      href !== "/staff" &&
      pathname.startsWith(`${href}/`))
  );
}

function NavLinksList({
  links,
  pathname,
  onNavigate,
  className,
}: {
  links: NavLink[];
  pathname: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav className={cn("space-y-1", className)}>
      {links.map((link) => {
        const Icon = link.icon;
        const isActive = isNavLinkActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground shadow-sm ring-1 ring-border before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--candid-yellow)]"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span>{link.label}</span>
              {link.badgeCount ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--candid-yellow)] px-1.5 py-0.5 text-[10px] font-semibold text-neutral-950">
                  {link.badgeCount > 9 ? "9+" : link.badgeCount}
                </span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarAccountFooter({
  displayName,
  displaySubtitle,
  profileHref,
  userAvatarUrl,
  onNavigate,
  onLogout,
}: {
  displayName: string;
  displaySubtitle: string;
  profileHref: string | null;
  userAvatarUrl: string | null;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-border p-4">
      <div className="mb-3 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-3">
        {profileHref ? (
          <Link href={profileHref} className="shrink-0" onClick={onNavigate}>
            <StaffAvatarDisplay
              fullName={displayName}
              avatarUrl={userAvatarUrl}
              size="md"
            />
          </Link>
        ) : (
          <StaffAvatarDisplay
            fullName={displayName}
            avatarUrl={userAvatarUrl}
            size="md"
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {profileHref ? (
              <Link href={profileHref} className="hover:underline" onClick={onNavigate}>
                {displayName}
              </Link>
            ) : (
              displayName
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {displaySubtitle}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </div>
  );
}

export function AppShell({
  children,
  userRole = "customer",
  showStaffNav = false,
  showCrmNav = false,
  showGlobalSearch,
  updatesUnreadCount = 0,
  userName,
  companyName,
  accountStatusSubtitle,
  userAvatarUrl = null,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const canShowGlobalSearch =
    showGlobalSearch ?? (showCrmNav && userRole !== "customer");

  useGlobalSearchShortcut(openSearch);

  const links =
    userRole === "admin"
      ? [
          ...adminLinks.slice(0, 5),
          ...(showCrmNav ? crmLinks : []),
          ...adminLinks.slice(5),
          ...(showStaffNav ? [staffManagementLink] : []),
        ]
      : userRole === "staff"
        ? [...staffLinks, ...(showCrmNav ? crmLinks : [])]
        : customerLinks;

  const linksWithBadges = links.map((link) =>
    link.href === "/updates" && updatesUnreadCount > 0
      ? { ...link, badgeCount: updatesUnreadCount }
      : link
  );

  assertUniqueNavHrefs(
    linksWithBadges,
    userRole === "admin"
      ? "admin navigation"
      : userRole === "staff"
        ? "staff navigation"
        : "customer navigation"
  );

  const homeHref =
    userRole === "admin" ? "/admin" : userRole === "staff" ? "/staff" : "/dashboard";
  const portalLabel =
    userRole === "admin"
      ? "Administration"
      : userRole === "staff"
        ? "Staff workspace"
        : "Customer portal";
  const displayName = userName || "Candid OS user";
  const displayCompany = companyName || "Candid Creative";
  const displaySubtitle =
    userRole === "customer"
      ? accountStatusSubtitle || getCustomerPortalStatusSubtitle(null)
      : displayCompany;
  const profileHref =
    userRole === "admin" || userRole === "staff" ? "/staff/profile" : null;

  async function handleLogout() {
    closeMobileNav();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMobileNav();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileNavOpen, closeMobileNav]);

  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  return (
    <div className="min-h-screen bg-[var(--portal-page-bg)]">
      {userRole === "admin" || userRole === "staff" ? (
        <CommunicationModeBanner />
      ) : null}
      <aside className="fixed inset-y-0 left-0 z-30 hidden h-dvh max-h-dvh w-[17.5rem] flex-col overflow-hidden border-r border-border bg-card lg:flex">
        <div className="shrink-0 border-b border-border px-5 py-5">
          <Link href={homeHref} className="group flex items-center gap-3">
            <Image
              src="/LOGO_YELLOW.svg"
              alt="Candid Creative"
              width={112}
              height={55}
              priority
              className="h-auto w-[5.5rem] shrink-0 transition-opacity group-hover:opacity-90"
            />

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                Candid OS
              </p>
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {portalLabel}
              </p>
            </div>
          </Link>
        </div>

        {canShowGlobalSearch ? (
          <div className="shrink-0 px-3 pb-3">
            <GlobalSearchTrigger onOpen={openSearch} />
          </div>
        ) : null}

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          <NavLinksList links={linksWithBadges} pathname={pathname} />
        </nav>

        <SidebarAccountFooter
          displayName={displayName}
          displaySubtitle={displaySubtitle}
          profileHref={profileHref}
          userAvatarUrl={userAvatarUrl}
          onLogout={handleLogout}
        />
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={closeMobileNav}
          />

          <aside
            id="mobile-navigation-menu"
            className="relative flex h-dvh max-h-dvh w-[min(100vw,17.5rem)] flex-col overflow-hidden border-r border-border bg-card shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <Link
                href={homeHref}
                className="group flex min-w-0 flex-1 items-center gap-3"
                onClick={closeMobileNav}
              >
                <Image
                  src="/LOGO_YELLOW.svg"
                  alt="Candid Creative"
                  width={96}
                  height={47}
                  priority
                  className="h-auto w-20 shrink-0 transition-opacity group-hover:opacity-90"
                />

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                    Candid OS
                  </p>
                  <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {portalLabel}
                  </p>
                </div>
              </Link>

              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={closeMobileNav}
                className="ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <NavLinksList
                links={linksWithBadges}
                pathname={pathname}
                onNavigate={closeMobileNav}
              />
            </div>

            <SidebarAccountFooter
              displayName={displayName}
              displaySubtitle={displaySubtitle}
              profileHref={profileHref}
              userAvatarUrl={userAvatarUrl}
              onNavigate={closeMobileNav}
              onLogout={handleLogout}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[17.5rem]">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 px-4 py-4 backdrop-blur sm:px-6 lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation-menu"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted/70"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>

            <Image
              src="/LOGO_YELLOW.svg"
              alt="Candid Creative"
              width={96}
              height={47}
              className="h-auto w-20 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">Candid OS</p>
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {portalLabel}
              </p>
            </div>
          </div>

          {canShowGlobalSearch ? (
            <div className="mt-3">
              <GlobalSearchTrigger onOpen={openSearch} />
            </div>
          ) : null}
        </header>

        <main className="px-6 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>

      {canShowGlobalSearch ? (
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      ) : null}
    </div>
  );
}
