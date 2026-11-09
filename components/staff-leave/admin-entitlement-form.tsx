"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { StaffMemberOption } from "@/lib/staff-leave/queries";

type EntitlementSeed = {
  profileId: string;
  adjustmentDays: number;
  prorataStartDate: string | null;
};

export function AdminEntitlementForm({
  members,
  holidayYear,
  seeds,
}: {
  members: StaffMemberOption[];
  holidayYear: number;
  seeds: EntitlementSeed[];
}) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(members[0]?.id ?? "");
  const seed = seeds.find((row) => row.profileId === profileId);
  const [adjustmentDays, setAdjustmentDays] = useState(String(seed?.adjustmentDays ?? 0));
  const [prorataStartDate, setProrataStartDate] = useState(seed?.prorataStartDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleMemberChange(nextId: string) {
    setProfileId(nextId);
    const nextSeed = seeds.find((row) => row.profileId === nextId);
    setAdjustmentDays(String(nextSeed?.adjustmentDays ?? 0));
    setProrataStartDate(nextSeed?.prorataStartDate ?? "");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/admin/leave/entitlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        holidayYear,
        adjustmentDays: Number(adjustmentDays),
        prorataStartDate: prorataStartDate || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not save entitlement adjustment.");
      return;
    }

    router.refresh();
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No approved staff profiles found.</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Adjust annual allowance for {holidayYear}. Working patterns are read from the
        latest staff working pattern record when present.
      </p>

      <div className="space-y-2">
        <Label htmlFor="entitlement-member">Employee</Label>
        <Select
          id="entitlement-member"
          value={profileId}
          onChange={(event) => handleMemberChange(event.target.value)}
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.id}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="adjustmentDays">Adjustment days</Label>
          <Input
            id="adjustmentDays"
            type="number"
            step="0.5"
            required
            value={adjustmentDays}
            onChange={(event) => setAdjustmentDays(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prorataStartDate">Pro-rata start (optional)</Label>
          <Input
            id="prorataStartDate"
            type="date"
            value={prorataStartDate}
            onChange={(event) => setProrataStartDate(event.target.value)}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save adjustment"}
      </Button>
    </form>
  );
}
