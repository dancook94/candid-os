"use client";

import { useCallback, useEffect, useState } from "react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StaffMemberOption } from "@/lib/staff-leave/queries";

type BalanceSnapshot = {
  entitlement_days: number;
  approved_days: number;
  pending_days: number;
  remaining_days: number;
};

type BookingMode = "closed" | "self" | "employee";

export function AdminLeaveBooking({
  holidayYear,
  viewerProfileId,
  viewerName,
  members,
  initialViewerBalance,
}: {
  holidayYear: number;
  viewerProfileId: string;
  viewerName: string | null;
  members: StaffMemberOption[];
  initialViewerBalance: BalanceSnapshot | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<BookingMode>("closed");
  const [leaveKind, setLeaveKind] = useState<"annual" | "additional_paid">("annual");
  const [employeeId, setEmployeeId] = useState(
    members.find((member) => member.id !== viewerProfileId)?.id ?? members[0]?.id ?? ""
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dayPortion, setDayPortion] = useState("full");
  const [employeeNote, setEmployeeNote] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [balance, setBalance] = useState<BalanceSnapshot | null>(initialViewerBalance);
  const [balanceProfileId, setBalanceProfileId] = useState(viewerProfileId);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [previewDays, setPreviewDays] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadBalance = useCallback(
    async (profileId: string) => {
      if (!profileId) return;
      setLoadingBalance(true);
      const response = await fetch(
        `/api/admin/leave/balance?profileId=${encodeURIComponent(profileId)}&year=${holidayYear}`
      );
      const payload = (await response.json().catch(() => ({}))) as {
        balance?: BalanceSnapshot;
        error?: string;
      };
      setLoadingBalance(false);
      if (!response.ok || !payload.balance) {
        setBalance(null);
        return;
      }
      setBalance({
        entitlement_days: Number(payload.balance.entitlement_days),
        approved_days: Number(payload.balance.approved_days),
        pending_days: Number(payload.balance.pending_days),
        remaining_days: Number(payload.balance.remaining_days),
      });
    },
    [holidayYear]
  );

  useEffect(() => {
    if (mode === "closed") return;
    const profileId = mode === "self" ? viewerProfileId : employeeId;
    setBalanceProfileId(profileId);
    void loadBalance(profileId);
  }, [mode, leaveKind, viewerProfileId, employeeId, loadBalance]);

  const annualBooking = leaveKind === "annual";

  useEffect(() => {
    if (mode === "closed" || !annualBooking) {
      setPreviewDays(null);
      setPreviewError(null);
      return;
    }

    if (!startDate || !endDate || !dayPortion) {
      setPreviewDays(null);
      setPreviewError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        setLoadingPreview(true);
        const params = new URLSearchParams({
          startDate,
          endDate,
          dayPortion,
        });

        const url =
          mode === "self"
            ? `/api/staff/leave/request-days?${params}`
            : `/api/admin/leave/request-days?${new URLSearchParams({
                ...Object.fromEntries(params),
                profileId: employeeId,
              })}`;

        const response = await fetch(url);
        const payload = (await response.json().catch(() => ({}))) as {
          days?: number;
          error?: string;
        };
        setLoadingPreview(false);

        if (!response.ok) {
          setPreviewDays(null);
          setPreviewError(payload.error ?? "Could not preview working days.");
          return;
        }

        setPreviewError(null);
        setPreviewDays(Number(payload.days));
      })();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [mode, annualBooking, startDate, endDate, dayPortion, employeeId]);

  function resetFields() {
    setStartDate("");
    setEndDate("");
    setDayPortion("full");
    setEmployeeNote("");
    setGrantReason("");
    setPreviewDays(null);
    setPreviewError(null);
    setError(null);
  }

  function openSelf() {
    resetFields();
    setLeaveKind("annual");
    setMode("self");
  }

  function openEmployee() {
    resetFields();
    setLeaveKind("annual");
    setMode("employee");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    let response: Response;

    if (mode === "self") {
      if (leaveKind === "annual") {
        response = await fetch("/api/staff/leave/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
            dayPortion,
            employeeNote: employeeNote || null,
          }),
        });
      } else {
        response = await fetch("/api/staff/leave/additional-paid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
            dayPortion,
            employeeNote: employeeNote || null,
          }),
        });
      }
    } else if (leaveKind === "annual") {
      response = await fetch("/api/admin/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: employeeId,
          startDate,
          endDate,
          dayPortion,
          employeeNote: employeeNote || null,
        }),
      });
    } else {
      response = await fetch("/api/admin/leave/additional-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: employeeId,
          startDate,
          endDate,
          dayPortion,
          grantReason,
          decisionNote: employeeNote || null,
        }),
      });
    }

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not save leave.");
      return;
    }

    resetFields();
    setMode("closed");
    router.refresh();
  }

  const employeeOptions = members.filter((member) => member.id !== viewerProfileId);

  const selfAnnualPending = mode === "self" && leaveKind === "annual";
  const employeeAnnualPending = mode === "employee" && leaveKind === "annual";
  const employeeGrant = mode === "employee" && leaveKind === "additional_paid";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button type="button" size="lg" className="w-full sm:w-auto" onClick={openSelf}>
          Book my holiday
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={openEmployee}
          disabled={employeeOptions.length === 0}
        >
          Book leave for employee
        </Button>
      </div>

      {mode !== "closed" ? (
        <Card className="portal-surface rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>
              {mode === "self"
                ? "Book my holiday"
                : "Book leave for employee"}
            </CardTitle>
            <CardDescription>
              {mode === "self" ? (
                <>
                  Submit your own requests here instead of opening{" "}
                  <span className="font-medium text-foreground">/staff/leave</span>.
                  Another manager must approve annual leave; you cannot approve your own
                  requests.
                </>
              ) : employeeAnnualPending ? (
                <>
                  Creates a <strong>pending</strong> annual request for the selected
                  employee. This is submission only — use the pending queue below to approve
                  or decline (you still cannot approve your own leave).
                </>
              ) : employeeGrant ? (
                <>
                  Grants additional paid leave immediately (approved). It does not reduce
                  annual allowance.
                </>
              ) : (
                <>
                  Requests additional paid leave for you (pending). Another manager must
                  approve; you cannot approve your own request.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {mode === "employee" ? (
              <div className="space-y-2">
                <Label htmlFor="booking-employee">Employee</Label>
                <Select
                  id="booking-employee"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  {employeeOptions.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name ?? "Team member"}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Booking for <strong>{viewerName ?? "you"}</strong>.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={leaveKind === "annual" ? "default" : "outline"}
                onClick={() => setLeaveKind("annual")}
              >
                Annual leave
              </Button>
              <Button
                type="button"
                size="sm"
                variant={leaveKind === "additional_paid" ? "default" : "outline"}
                onClick={() => setLeaveKind("additional_paid")}
              >
                {mode === "employee" && leaveKind === "additional_paid"
                  ? "Grant additional paid"
                  : "Additional paid leave"}
              </Button>
            </div>

            {balance ? (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">
                  Remaining annual allowance{" "}
                  {mode === "employee"
                    ? `for ${
                        members.find((member) => member.id === balanceProfileId)?.full_name ??
                        "employee"
                      }`
                    : "for you"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {loadingBalance ? (
                    "Refreshing…"
                  ) : (
                    <>
                      <span className="text-foreground font-semibold">
                        {balance.remaining_days} days
                      </span>{" "}
                      remaining of {balance.entitlement_days} bookable (
                      {balance.approved_days} approved, {balance.pending_days} pending)
                    </>
                  )}
                </p>
                {(selfAnnualPending || employeeAnnualPending) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Submission is blocked if the requested days exceed remaining allowance.
                  </p>
                )}
              </div>
            ) : null}

            {annualBooking && startDate && endDate ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm">
                <p className="font-medium text-foreground">Requested working days (database)</p>
                <p className="mt-1 text-muted-foreground">
                  {loadingPreview ? (
                    "Calculating…"
                  ) : previewError ? (
                    previewError
                  ) : previewDays == null ? (
                    "Enter dates to preview bookable days."
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">{previewDays}</span>
                      {previewDays === 1 ? " day" : " days"} ({dayPortion}) after bank holidays,
                      closures and working pattern rules.
                    </>
                  )}
                </p>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Holiday year {holidayYear}. Half-day requests must use the same start and
                end date.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="booking-start">Start date</Label>
                  <Input
                    id="booking-start"
                    type="date"
                    required
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="booking-end">End date</Label>
                  <Input
                    id="booking-end"
                    type="date"
                    required
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="booking-portion">Duration</Label>
                <Select
                  id="booking-portion"
                  value={dayPortion}
                  onChange={(event) => setDayPortion(event.target.value)}
                >
                  <option value="full">Full day</option>
                  <option value="am">Morning (AM)</option>
                  <option value="pm">Afternoon (PM)</option>
                </Select>
              </div>

              {employeeGrant ? (
                <div className="space-y-2">
                  <Label htmlFor="booking-grant-reason">Grant reason (required)</Label>
                  <Textarea
                    id="booking-grant-reason"
                    rows={2}
                    required
                    value={grantReason}
                    onChange={(event) => setGrantReason(event.target.value)}
                    placeholder="Why is this additional paid leave being granted?"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="booking-note">
                  {employeeGrant ? "Internal note (optional)" : "Note (optional)"}
                </Label>
                <Textarea
                  id="booking-note"
                  rows={2}
                  value={employeeNote}
                  onChange={(event) => setEmployeeNote(event.target.value)}
                  placeholder={
                    mode === "employee" && leaveKind === "annual"
                      ? "Shown on the request; another approver will review."
                      : undefined
                  }
                />
              </div>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMode("closed");
                    resetFields();
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    (annualBooking &&
                      (loadingPreview ||
                        previewDays == null ||
                        previewDays <= 0 ||
                        !!previewError))
                  }
                >
                  {submitting
                    ? "Saving…"
                    : employeeGrant
                      ? "Grant additional paid leave"
                      : mode === "employee" && leaveKind === "annual"
                        ? "Submit pending request"
                        : leaveKind === "additional_paid"
                          ? "Submit additional paid request"
                          : "Submit holiday request"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
