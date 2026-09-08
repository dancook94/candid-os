"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { StaffAuthActionButton } from "@/components/staff-auth-action-button";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRoleLabel } from "@/lib/staff-roles";
import { resolveStaffAuthActionType } from "@/lib/staff-auth-actions";
import type { StaffMemberRecord } from "@/lib/staff-members";

type StaffManagementTableProps = {
  staffMembers: StaffMemberRecord[];
};

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const roleBadgeMap: Record<string, BadgeStatus> = {
  super_admin: "sent",
  admin: "accepted",
  sales: "pending",
  production: "draft",
  accounts: "sent",
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatLastSignIn(dateString: string | null) {
  if (!dateString) {
    return "Never";
  }

  return new Date(dateString).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapAccountStatus(status: string): BadgeStatus {
  if (status === "approved") {
    return "approved";
  }

  if (status === "disabled") {
    return "disabled";
  }

  return "pending";
}

function formatAccountStatusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function StaffManagementTable({
  staffMembers,
}: StaffManagementTableProps) {
  const [query, setQuery] = useState("");

  const filteredStaff = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return staffMembers;
    }

    return staffMembers.filter((member) => {
      const haystack = [
        member.full_name ?? "",
        member.email ?? "",
        member.user_role,
        member.account_status,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [query, staffMembers]);

  return (
    <div className="space-y-4">
      <Card className="portal-surface rounded-2xl shadow-sm ring-0">
        <CardContent className="p-4">
          <label htmlFor="staff-search" className="sr-only">
            Search staff
          </label>
          <Input
            id="staff-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, role or status..."
            className="h-11 rounded-xl border-border bg-background"
          />
        </CardContent>
      </Card>

      <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last sign in</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredStaff.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      No staff members match your search.
                    </td>
                  </tr>
                ) : (
                  filteredStaff.map((member) => {
                    const authActionType = resolveStaffAuthActionType({
                      invited_at: member.invited_at,
                      email_confirmed_at: member.email_confirmed_at,
                      confirmed_at: member.confirmed_at,
                      last_sign_in_at: member.last_sign_in_at,
                    });

                    return (
                    <tr key={member.id}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <StaffAvatarDisplay
                            fullName={member.full_name || "Unnamed user"}
                            avatarUrl={member.avatarUrl}
                            size="sm"
                          />
                          <span className="font-medium text-foreground">
                            {member.full_name || "Unnamed user"}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-muted-foreground">
                        {member.email || "—"}
                      </td>

                      <td className="px-4 py-3.5">
                        <StatusBadge
                          status={roleBadgeMap[member.user_role] ?? "draft"}
                          label={formatRoleLabel(member.user_role)}
                        />
                      </td>

                      <td className="px-4 py-3.5">
                        <StatusBadge
                          status={mapAccountStatus(member.account_status)}
                          label={formatAccountStatusLabel(member.account_status)}
                        />
                      </td>

                      <td className="px-4 py-3.5 text-muted-foreground">
                        {formatDate(member.created_at)}
                      </td>

                      <td className="px-4 py-3.5 text-muted-foreground">
                        {formatLastSignIn(member.last_sign_in_at)}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-start gap-2">
                          <Link
                            href={`/admin/staff/${member.id}`}
                            className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            Edit
                          </Link>

                          {authActionType ? (
                            <StaffAuthActionButton
                              staffId={member.id}
                              email={member.email}
                              actionType={authActionType}
                              compact
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
