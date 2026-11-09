"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function AdditionalPaidLeaveForm() {
  const router = useRouter();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dayPortion, setDayPortion] = useState("full");
  const [employeeNote, setEmployeeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/staff/leave/additional-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate,
        endDate,
        dayPortion,
        employeeNote: employeeNote || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not submit request.");
      return;
    }

    setStartDate("");
    setEndDate("");
    setEmployeeNote("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Additional paid leave does not reduce your annual holiday allowance. Management must
        approve the request.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="apl-start">Start date</Label>
          <Input
            id="apl-start"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="apl-end">End date</Label>
          <Input
            id="apl-end"
            type="date"
            required
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="apl-portion">Day portion</Label>
        <Select
          id="apl-portion"
          value={dayPortion}
          onChange={(event) => setDayPortion(event.target.value)}
        >
          <option value="full">Full day</option>
          <option value="am">AM (half day)</option>
          <option value="pm">PM (half day)</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="apl-note">Note</Label>
        <Textarea
          id="apl-note"
          rows={2}
          value={employeeNote}
          onChange={(event) => setEmployeeNote(event.target.value)}
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" disabled={submitting} variant="outline">
        {submitting ? "Submitting…" : "Request additional paid leave"}
      </Button>
    </form>
  );
}
