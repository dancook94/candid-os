"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
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
} from "@/lib/staff-roles";

export function InviteStaffDialog() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("admin");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function resetForm() {
    setFullName("");
    setEmail("");
    setRole("admin");
    setError("");
    setSuccess("");
  }

  function handleClose() {
    if (isSubmitting) {
      return;
    }

    setOpen(false);
    resetForm();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const trimmedFullName = fullName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedFullName) {
      setError("Full name is required.");
      return;
    }

    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/invite-staff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: trimmedFullName,
          email: trimmedEmail,
          role,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to send invitation.");
        return;
      }

      setSuccess(payload.message ?? "Invitation sent successfully.");
      router.refresh();

      window.setTimeout(() => {
        handleClose();
      }, 800);
    } catch {
      setError("Unable to send invitation.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" size="lg" onClick={() => setOpen(true)}>
        + Invite Staff Member
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={handleClose}
          />

          <Card className="relative z-10 w-full max-w-lg rounded-2xl border-neutral-200 shadow-lg ring-0">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-lg font-semibold text-neutral-950">
                Invite staff member
              </CardTitle>
              <CardDescription>
                Send an invitation email so the team member can set their
                password and access Candid OS.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="invite-staff-full-name">Full name</Label>
                  <Input
                    id="invite-staff-full-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Daniel Cook"
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-staff-email">Email</Label>
                  <Input
                    id="invite-staff-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="staff@candidcreative.co.uk"
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-staff-role">Role</Label>
                  <select
                    id="invite-staff-role"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    disabled={isSubmitting}
                    className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
                    required
                  >
                    {INVITEABLE_STAFF_ROLES.map((staffRole) => (
                      <option key={staffRole} value={staffRole}>
                        {formatRoleLabel(staffRole)}
                      </option>
                    ))}
                  </select>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-medium text-red-800">
                      Invitation failed
                    </p>
                    <p className="mt-1 text-sm text-red-700">{error}</p>
                  </div>
                ) : null}

                {success ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-medium text-emerald-800">
                      {success}
                    </p>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Sending..." : "Send invitation"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
