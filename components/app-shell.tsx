"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  LogOut,
  Package,
  Settings,
  UserCog,
  Users,
} from "lucide-react";

import { CompanyLogoDisplay } from "@/components/company-logo-display";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  userRole?: "customer" | "admin" | "staff";
  showStaffNav?: boolean;
  userName?: string;
  companyName?: string;
  companyLogoUrl?: string | null;
  userAvatarUrl?: string | null;
};

const customerLinks = [
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
];

const adminLinks = [
  {
    href: "/admin",
    label: "Admin dashboard",
    icon: Gauge,
  },
  {
    href: "/admin/customers",
    label: "Customers",
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
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
  },
];

const staffManagementLink = {
  href: "/admin/staff",
  label: "Staff",
  icon: UserCog,
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "CO";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

const staffLinks = [
  {
    href: "/staff",
    label: "Workspace",
    icon: Gauge,
  },
];

export function AppShell({
  children,
  userRole = "customer",
  showStaffNav = false,
  userName,
  companyName,
  companyLogoUrl = null,
  userAvatarUrl = null,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const links =
    userRole === "admin"
      ? showStaffNav
        ? [...adminLinks, staffManagementLink]
        : adminLinks
      : userRole === "staff"
        ? staffLinks
        : customerLinks;
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
  const showStaffAvatar = userRole === "admin" || userRole === "staff";
  const profileHref = showStaffAvatar ? "/staff/profile" : null;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--portal-page-bg)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17.5rem] border-r border-border bg-card lg:flex lg:flex-col">
        <div className="border-b border-border px-5 py-5">
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

        <nav className="flex-1 space-y-1 px-3 py-4">
          {links.map((link) => {
            const Icon = link.icon;

            const isActive =
              pathname === link.href ||
              (link.href !== "/admin" &&
                link.href !== "/dashboard" &&
                link.href !== "/staff" &&
                pathname.startsWith(`${link.href}/`));

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-muted text-foreground shadow-sm ring-1 ring-border before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--candid-yellow)]"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-3">
            {showStaffAvatar ? (
              profileHref ? (
                <Link href={profileHref} className="shrink-0">
                  <StaffAvatarDisplay
                    fullName={displayName}
                    avatarUrl={userAvatarUrl}
                    size="sm"
                  />
                </Link>
              ) : (
                <StaffAvatarDisplay
                  fullName={displayName}
                  avatarUrl={userAvatarUrl}
                  size="sm"
                />
              )
            ) : (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
                aria-hidden
              >
                {getInitials(displayName)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profileHref ? (
                  <Link href={profileHref} className="hover:underline">
                    {displayName}
                  </Link>
                ) : (
                  displayName
                )}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                {userRole === "customer" && companyLogoUrl ? (
                  <CompanyLogoDisplay
                    companyName={displayCompany}
                    logoUrl={companyLogoUrl}
                    size="sm"
                    className="rounded-lg"
                  />
                ) : null}
                <p className="truncate text-xs text-muted-foreground">
                  {displayCompany}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-[17.5rem]">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 px-6 py-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            <Image
              src="/LOGO_YELLOW.svg"
              alt="Candid Creative"
              width={96}
              height={47}
              className="h-auto w-20 shrink-0"
            />
            <div>
              <p className="text-sm font-semibold text-foreground">Candid OS</p>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {portalLabel}
              </p>
            </div>
          </div>
        </header>

        <main className="px-6 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
