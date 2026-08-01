"use client";

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
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type AppShellProps = {
  children: React.ReactNode;
  userRole?: "customer" | "admin";
  userName?: string;
  companyName?: string;
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

export function AppShell({
  children,
  userRole = "customer",
  userName,
  companyName,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const links = userRole === "admin" ? adminLinks : customerLinks;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-200 bg-white lg:flex lg:flex-col">
        <div className="border-b border-neutral-200 px-6 py-6">
          <Link href={userRole === "admin" ? "/admin" : "/dashboard"}>
            <p className="text-xl font-semibold tracking-tight text-neutral-950">
              Candid OS
            </p>
          </Link>

          <p className="mt-1 text-xs font-medium uppercase tracking-wider text-neutral-400">
            {userRole === "admin" ? "Administration" : "Customer portal"}
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5">
          {links.map((link) => {
            const Icon = link.icon;

            const isActive =
              pathname === link.href ||
              (link.href !== "/admin" &&
                link.href !== "/dashboard" &&
                pathname.startsWith(`${link.href}/`));

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-neutral-950 text-white"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
                }`}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-neutral-200 p-4">
          <div className="mb-3 px-2">
            <p className="truncate text-sm font-medium text-neutral-900">
              {userName || "Candid OS user"}
            </p>

            <p className="truncate text-xs text-neutral-500">
              {companyName || "Candid Creative"}
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="border-b border-neutral-200 bg-white px-6 py-4 lg:hidden">
          <p className="font-semibold text-neutral-950">Candid OS</p>
        </header>

        <main className="px-6 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}