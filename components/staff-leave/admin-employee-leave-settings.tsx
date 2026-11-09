"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StaffMemberOption } from "@/lib/staff-leave/queries";

type PatternSeed = {
  effectiveFrom: string;
  worksMon: boolean;
  worksTue: boolean;
  worksWed: boolean;
  worksThu: boolean;
  worksFri: boolean;
  worksSat: boolean;
  worksSun: boolean;
  fteRatio: number;
};

type EntitlementSeed = {
  adjustmentDays: number;
  prorataStartDate: string | null;
  adjustmentReason: string | null;
};

type BreakdownRow = {
  gross_allowance_days: number;
  bank_holidays_on_working_days: number;
  compulsory_closures_on_working_days: number;
  paid_gift_closures_on_working_days: number;
  reserved_pool_days: number;
  fte_ratio: number;
  adjustment_days: number;
  prorata_start_date: string | null;
  bookable_entitlement_days: number;
  approved_annual_days: number;
  pending_annual_days: number;
  remaining_annual_days: number;
  pattern_effective_from: string | null;
  additional_paid_approved_days: number;
};

const WEEKDAYS = [
  ["worksMon", "Mon"],
  ["worksTue", "Tue"],
  ["worksWed", "Wed"],
  ["worksThu", "Thu"],
  ["worksFri", "Fri"],
  ["worksSat", "Sat"],
  ["worksSun", "Sun"],
] as const;

export function AdminEmployeeLeaveSettings({
  members,
  holidayYear,
  patternSeeds,
  entitlementSeeds,
  patternHistory,
}: {
  members: StaffMemberOption[];
  holidayYear: number;
  patternSeeds: Record<string, PatternSeed>;
  entitlementSeeds: Record<string, EntitlementSeed>;
  patternHistory: Record<string, { effective_from: string }[]>;
}) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(members[0]?.id ?? "");
  const [pattern, setPattern] = useState<PatternSeed>(
    patternSeeds[profileId] ?? {
      effectiveFrom: `${holidayYear}-01-01`,
      worksMon: true,
      worksTue: true,
      worksWed: true,
      worksThu: true,
      worksFri: true,
      worksSat: false,
      worksSun: false,
      fteRatio: 1,
    }
  );
  const [entitlement, setEntitlement] = useState<EntitlementSeed>(
    entitlementSeeds[profileId] ?? {
      adjustmentDays: 0,
      prorataStartDate: null,
      adjustmentReason: null,
    }
  );
  const [patternNote, setPatternNote] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [breakdown, setBreakdown] = useState<BreakdownRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grantReason, setGrantReason] = useState("");
  const [grantStart, setGrantStart] = useState("");
  const [grantEnd, setGrantEnd] = useState("");
  const [grantPortion, setGrantPortion] = useState("full");

  useEffect(() => {
    const nextPattern = patternSeeds[profileId];
    const nextEnt = entitlementSeeds[profileId];
    if (nextPattern) setPattern(nextPattern);
    if (nextEnt) setEntitlement(nextEnt);
    setPatternNote("");
    setAdjustmentReason(nextEnt?.adjustmentReason ?? "");
  }, [profileId, patternSeeds, entitlementSeeds]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    void fetch(
      `/api/admin/leave/entitlement-breakdown?profileId=${encodeURIComponent(profileId)}&year=${holidayYear}`
    )
      .then((res) => res.json())
      .then((payload: { breakdown?: BreakdownRow; error?: string }) => {
        if (!cancelled) {
          if (payload.breakdown) setBreakdown(payload.breakdown);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileId, holidayYear, busy]);

  async function savePattern(event: React.FormEvent) {
    event.preventDefault();
    setBusy("pattern");
    setError(null);
    const response = await fetch("/api/admin/leave/working-pattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        effectiveFrom: pattern.effectiveFrom,
        worksMon: pattern.worksMon,
        worksTue: pattern.worksTue,
        worksWed: pattern.worksWed,
        worksThu: pattern.worksThu,
        worksFri: pattern.worksFri,
        worksSat: pattern.worksSat,
        worksSun: pattern.worksSun,
        fteRatio: pattern.fteRatio,
        changeNote: patternNote,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(payload.error ?? "Could not save working pattern.");
      return;
    }
    router.refresh();
  }

  async function saveEntitlement(event: React.FormEvent) {
    event.preventDefault();
    setBusy("entitlement");
    setError(null);
    const response = await fetch("/api/admin/leave/entitlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        holidayYear,
        adjustmentDays: entitlement.adjustmentDays,
        prorataStartDate: entitlement.prorataStartDate,
        adjustmentReason,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(payload.error ?? "Could not save entitlement.");
      return;
    }
    router.refresh();
  }

  async function grantAdditionalPaid(event: React.FormEvent) {
    event.preventDefault();
    setBusy("grant");
    setError(null);
    const response = await fetch("/api/admin/leave/additional-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        startDate: grantStart,
        endDate: grantEnd,
        dayPortion: grantPortion,
        grantReason,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(payload.error ?? "Could not grant additional paid leave.");
      return;
    }
    setGrantReason("");
    setGrantStart("");
    setGrantEnd("");
    router.refresh();
  }

  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">No approved staff profiles found.</p>;
  }

  const history = patternHistory[profileId] ?? [];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Label htmlFor="settings-member">Employee</Label>
        <Select
          id="settings-member"
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.id}
            </option>
          ))}
        </Select>
      </div>

      {breakdown ? (
        <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <p>
            <span className="text-muted-foreground">Gross annual (incl. bank holidays):</span>{" "}
            <strong>{breakdown.gross_allowance_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Bank holidays on working days:</span>{" "}
            <strong>{breakdown.bank_holidays_on_working_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Compulsory Christmas leave:</span>{" "}
            <strong>{breakdown.compulsory_closures_on_working_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Gifted closure days:</span>{" "}
            <strong>{breakdown.paid_gift_closures_on_working_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Reserved pool:</span>{" "}
            <strong>{breakdown.reserved_pool_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Bookable allowance:</span>{" "}
            <strong>{breakdown.bookable_entitlement_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Remaining annual:</span>{" "}
            <strong>{breakdown.remaining_annual_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Additional paid (approved):</span>{" "}
            <strong>{breakdown.additional_paid_approved_days}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Pattern effective from:</span>{" "}
            <strong>{breakdown.pattern_effective_from ?? "Default Mon–Fri"}</strong>
          </p>
        </div>
      ) : null}

      <form onSubmit={savePattern} className="space-y-4 rounded-2xl border border-border p-4">
        <h3 className="text-base font-semibold">Working pattern</h3>
        <p className="text-sm text-muted-foreground">
          New patterns take effect from the date below. Existing holiday requests keep their
          recorded day counts.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pattern-effective">Effective from</Label>
            <Input
              id="pattern-effective"
              type="date"
              required
              value={pattern.effectiveFrom}
              onChange={(event) =>
                setPattern((current) => ({ ...current, effectiveFrom: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pattern-fte">FTE ratio</Label>
            <Input
              id="pattern-fte"
              type="number"
              min={0.01}
              max={1}
              step="0.01"
              required
              value={pattern.fteRatio}
              onChange={(event) =>
                setPattern((current) => ({
                  ...current,
                  fteRatio: Number(event.target.value),
                }))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {WEEKDAYS.map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={pattern[key]}
                onChange={(event) =>
                  setPattern((current) => ({ ...current, [key]: event.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pattern-note">Change note</Label>
          <Textarea
            id="pattern-note"
            rows={2}
            required
            value={patternNote}
            onChange={(event) => setPatternNote(event.target.value)}
            placeholder="Reason for pattern change (audit trail)"
          />
        </div>

        {history.length > 0 ? (
          <ul className="text-xs text-muted-foreground">
            {history.slice(0, 5).map((row) => (
              <li key={row.effective_from}>Effective from {row.effective_from}</li>
            ))}
          </ul>
        ) : null}

        <Button type="submit" disabled={busy === "pattern"}>
          Save working pattern
        </Button>
      </form>

      <form onSubmit={saveEntitlement} className="space-y-4 rounded-2xl border border-border p-4">
        <h3 className="text-base font-semibold">Allowance adjustment & pro-rata</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="adjustment-days">Adjustment days</Label>
            <Input
              id="adjustment-days"
              type="number"
              step="0.5"
              value={entitlement.adjustmentDays}
              onChange={(event) =>
                setEntitlement((current) => ({
                  ...current,
                  adjustmentDays: Number(event.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prorata-start">Employee start / pro-rata from</Label>
            <Input
              id="prorata-start"
              type="date"
              value={entitlement.prorataStartDate ?? ""}
              onChange={(event) =>
                setEntitlement((current) => ({
                  ...current,
                  prorataStartDate: event.target.value || null,
                }))
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="adjustment-reason">Adjustment reason</Label>
          <Textarea
            id="adjustment-reason"
            rows={2}
            value={adjustmentReason}
            onChange={(event) => setAdjustmentReason(event.target.value)}
            placeholder="Required when adjustment is not zero"
          />
        </div>
        <Button type="submit" disabled={busy === "entitlement"}>
          Save entitlement
        </Button>
      </form>

      <form onSubmit={grantAdditionalPaid} className="space-y-4 rounded-2xl border border-border p-4">
        <h3 className="text-base font-semibold">Grant additional paid leave</h3>
        <p className="text-sm text-muted-foreground">
          Paid time off that does not reduce annual holiday balance. Recorded and approved
          immediately.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="grant-start">Start</Label>
            <Input
              id="grant-start"
              type="date"
              required
              value={grantStart}
              onChange={(event) => setGrantStart(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grant-end">End</Label>
            <Input
              id="grant-end"
              type="date"
              required
              value={grantEnd}
              onChange={(event) => setGrantEnd(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grant-portion">Day portion</Label>
            <Select
              id="grant-portion"
              value={grantPortion}
              onChange={(event) => setGrantPortion(event.target.value)}
            >
              <option value="full">Full day</option>
              <option value="am">AM</option>
              <option value="pm">PM</option>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="grant-reason">Grant reason</Label>
          <Textarea
            id="grant-reason"
            rows={2}
            required
            value={grantReason}
            onChange={(event) => setGrantReason(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy === "grant"}>
          Grant additional paid leave
        </Button>
      </form>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
