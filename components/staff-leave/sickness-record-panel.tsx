"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StaffMemberOption } from "@/lib/staff-leave/queries";

type SicknessRow = {
  id: string;
  start_date: string;
  end_date: string;
  day_portion: string;
  days_recorded: number;
  reason: string | null;
  note: string | null;
  private_note?: string | null;
  holiday_year: number;
};

export function SicknessRecordPanel({
  members,
  holidayYear,
}: {
  members: StaffMemberOption[];
  holidayYear: number;
}) {
  const [profileId, setProfileId] = useState(members[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dayPortion, setDayPortion] = useState("full");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [records, setRecords] = useState<SicknessRow[]>([]);
  const [yearTotalDays, setYearTotalDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function loadHistory(nextProfileId: string) {
    if (!nextProfileId) return;
    setLoadingHistory(true);
    setError(null);

    const response = await fetch(
      `/api/admin/leave/sickness/history?profileId=${encodeURIComponent(nextProfileId)}&year=${holidayYear}`
    );
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      records?: SicknessRow[];
      yearTotalDays?: number;
    };

    setLoadingHistory(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not load sickness history.");
      setRecords([]);
      setYearTotalDays(null);
      return;
    }

    setRecords(payload.records ?? []);
    setYearTotalDays(typeof payload.yearTotalDays === "number" ? payload.yearTotalDays : null);
  }

  useEffect(() => {
    if (profileId) {
      void loadHistory(profileId);
    }
  }, [profileId, holidayYear]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/admin/leave/sickness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        startDate,
        endDate,
        dayPortion,
        reason: reason || null,
        note: note || null,
        privateNote: privateNote || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not record sickness.");
      return;
    }

    setStartDate("");
    setEndDate("");
    setReason("");
    setNote("");
    setPrivateNote("");
    await loadHistory(profileId);
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No approved staff profiles found.</p>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sickness-member">Employee</Label>
          <Select
            id="sickness-member"
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sick-start">Start date</Label>
            <Input
              id="sick-start"
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sick-end">End date</Label>
            <Input
              id="sick-end"
              type="date"
              required
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Duration</Label>
          <Select
            value={dayPortion}
            onChange={(event) => setDayPortion(event.target.value)}
          >
            <option value="full">Full day</option>
            <option value="am">Morning (AM)</option>
            <option value="pm">Afternoon (PM)</option>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sick-reason">Reason (optional)</Label>
          <Input
            id="sick-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sick-note">Note (optional)</Label>
          <Textarea
            id="sick-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sick-private">Private note (management only)</Label>
          <Textarea
            id="sick-private"
            rows={2}
            value={privateNote}
            onChange={(event) => setPrivateNote(event.target.value)}
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Record sickness"}
        </Button>
      </form>

      <div>
        <p className="text-sm font-medium text-foreground">
          {holidayYear} sickness total:{" "}
          {yearTotalDays == null ? "—" : `${yearTotalDays} day${yearTotalDays === 1 ? "" : "s"}`}
        </p>
        {loadingHistory ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading history…</p>
        ) : records.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No sickness records for this year.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {records.map((record) => (
              <li key={record.id} className="px-4 py-3 text-sm">
                <p className="font-medium">
                  {record.start_date === record.end_date
                    ? record.start_date
                    : `${record.start_date} → ${record.end_date}`}{" "}
                  · {record.days_recorded}d ({record.day_portion})
                </p>
                {record.reason ? (
                  <p className="text-muted-foreground">Reason: {record.reason}</p>
                ) : null}
                {record.note ? (
                  <p className="text-muted-foreground">Note: {record.note}</p>
                ) : null}
                {record.private_note ? (
                  <p className="text-muted-foreground">Private: {record.private_note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
