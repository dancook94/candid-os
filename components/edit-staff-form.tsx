"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INVITEABLE_STAFF_ROLES,
  formatRoleLabel,
  isSuperAdminRole,
} from "@/lib/staff-roles";

type EditStaffFormProps = {
  staffId: string;
  fullName: string;
  email: string | null;
  role: string;
  accountStatus: string;
};

export function EditStaffForm({
  staffId,
  fullName: initialFullName,
  email,
  role: initialRole,
  accountStatus: initialAccountStatus,
}: EditStaffFormProps) {
  const router = useRouter();

  const [fullName, setFullName] = useState(initialFullName);
  const [role, setRole] = useState(initialRole);
  const [accountStatus, setAccountStatus] = useState(initialAccountStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isSuperAdmin = isSuperAdminRole(initialRole);

  async function saveUpdates(updates: {
    fullName?: string;
    role?: string;
    accountStatus?: "approved" | "disabled";
  }) {
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/staff/${staffId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: updates.fullName,
          role: updates.role,
          accountStatus: updates.accountStatus,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to update staff member.");
        return false;
      }

      if (updates.accountStatus) {
        setAccountStatus(updates.accountStatus);
      }

      if (updates.role) {
        setRole(updates.role);
      }

      setSuccess("Staff member updated successfully.");
      router.refresh();
      return true;
    } catch {
      setError("Unable to update staff member.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedFullName = fullName.trim();

    if (!trimmedFullName) {
      setError("Full name is required.");
      return;
    }

    await saveUpdates({
      fullName: trimmedFullName,
      role: isSuperAdmin ? undefined : role,
    });
  }

  async function handleDeactivate() {
    await saveUpdates({ accountStatus: "disabled" });
  }

  async function handleReactivate() {
    await saveUpdates({ accountStatus: "approved" });
  }

  return (
    <div className="space-y-6">
      <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">Staff details</CardTitle>
          <CardDescription>
            Update this team member&apos;s profile and access level.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="staff-full-name">Full name</Label>
              <Input
                id="staff-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                value={email ?? "—"}
                disabled
                readOnly
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-role">Role</Label>
              {isSuperAdmin ? (
                <div className="flex h-10 items-center">
                  <StatusBadge status="sent" label={formatRoleLabel(role)} />
                </div>
              ) : (
                <select
                  id="staff-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  disabled={isSubmitting}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
                >
                  {INVITEABLE_STAFF_ROLES.map((staffRole) => (
                    <option key={staffRole} value={staffRole}>
                      {formatRoleLabel(staffRole)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Account status</Label>
              <div>
                <StatusBadge
                  status={
                    accountStatus === "approved" ? "approved" : "disabled"
                  }
                  label={
                    accountStatus.charAt(0).toUpperCase() +
                    accountStatus.slice(1)
                  }
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">{error}</p>
              </div>
            ) : null}

            {success ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-medium text-emerald-800">{success}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save changes"}
              </Button>

              {accountStatus === "approved" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={handleDeactivate}
                >
                  Deactivate account
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={handleReactivate}
                >
                  Reactivate account
                </Button>
              )}

              <Link
                href="/admin/staff"
                className={buttonVariants({ variant: "ghost" })}
                aria-disabled={isSubmitting}
              >
                Back to staff
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
