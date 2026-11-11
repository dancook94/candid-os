"use client";

import { useEffect, useState } from "react";

import { formatLondonWhen } from "@/lib/installations/labels";

type PublicationEvent = {
  id: string;
  eventType: "published" | "unpublished" | "replaced";
  createdAt: string;
  reportReference: string;
  versionNumber: number;
  previousReportReference: string | null;
  actorName: string | null;
};

const EVENT_LABELS: Record<PublicationEvent["eventType"], string> = {
  published: "Published",
  unpublished: "Unpublished",
  replaced: "Replaced",
};

export function InstallationVisitPublicationHistory({
  visitId,
  sampleReportId,
}: {
  visitId: string;
  sampleReportId: string | null;
}) {
  const [events, setEvents] = useState<PublicationEvent[] | null>(null);

  useEffect(() => {
    if (!sampleReportId) {
      setEvents([]);
      return;
    }
    void fetch(`/api/admin/installations/reports/${sampleReportId}/publication`)
      .then(async (response) => {
        if (!response.ok) {
          setEvents([]);
          return;
        }
        const payload = (await response.json()) as { events?: PublicationEvent[] };
        setEvents(payload.events ?? []);
      })
      .catch(() => setEvents([]));
  }, [sampleReportId, visitId]);

  if (!events || events.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Publication history</p>
      <ul className="space-y-1 text-xs text-neutral-600">
        {events.map((event) => (
          <li key={event.id} className="rounded border border-neutral-100 px-2 py-1.5">
            <span className="font-medium text-neutral-800">{EVENT_LABELS[event.eventType]}</span>
            {" · "}
            {event.reportReference} (v{event.versionNumber})
            {event.previousReportReference ? ` · replaced ${event.previousReportReference}` : ""}
            {" · "}
            {formatLondonWhen(event.createdAt)}
            {event.actorName ? ` · ${event.actorName}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
