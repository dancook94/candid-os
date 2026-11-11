"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { COMPLETION_CHECKLIST } from "@/lib/installations/completion";
import { checklistReportValues, hasOfficialInstallationSignOff, installationReportScopeStatement, installationReportSnagStatement, quoteReferenceLabel } from "@/lib/installations/completion-report";
import { isOutstandingInstallationSnag } from "@/lib/installations/job-signal";
import { PROJECT_STATUS_LABELS, formatLondonWhen } from "@/lib/installations/labels";
import { InstallationReportCustomerActions } from "@/components/installations/installation-report-customer-actions";
import { InstallationVisitPublicationHistory } from "@/components/installations/installation-visit-publication-history";
import type { InstallationProjectRecord, InstallationVisitRecord } from "@/lib/installations/queries";

async function readReportError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (payload?.error) {
    return payload.error;
  }

  return `The report could not be prepared (HTTP ${response.status}).`;
}

const PHASES = [
  ["before", "Before"],
  ["during", "During"],
  ["after", "After"],
] as const;

export function InstallationCompletionReport({
  visit,
  project,
}: {
  visit: InstallationVisitRecord;
  project: Pick<InstallationProjectRecord, "status" | "companyName" | "jobReference" | "quoteNumber">;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(visit.photos.map((photo) => photo.id));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checklist = checklistReportValues(visit.signOffChecklist);
  const canSaveOfficialReport = hasOfficialInstallationSignOff({
    customerAttendance: visit.signOffAttendance,
    customerName: visit.signOffName,
    declineReason: visit.signOffDeclineReason,
    signatureStoragePath: visit.signOffAttendance === "present" ? visit.signOffSignatureUrl : null,
    checklist: visit.signOffChecklist,
  });
  const outstanding = visit.snags.filter((snag) => isOutstandingInstallationSnag(snag.status)).length;
  const quote = quoteReferenceLabel(project.quoteNumber);
  const grouped = useMemo(
    () => PHASES.map(([phase, label]) => ({ phase, label, photos: visit.photos.filter((photo) => photo.kind === phase) })),
    [visit.photos]
  );

  async function requestReport(persist: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/installations/visits/${visit.id}/completion-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: selected, persist }),
      });
      if (!response.ok) {
        setMessage(await readReportError(response));
        return;
      }
      if (!persist) {
        const contentType = response.headers.get("content-type") ?? "";
        if (previewObjectUrl.current) {
          URL.revokeObjectURL(previewObjectUrl.current);
          previewObjectUrl.current = null;
        }
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { previewUrl?: string };
          if (!payload.previewUrl) {
            setMessage("The report preview could not be opened.");
            return;
          }
          setPreviewUrl(payload.previewUrl);
          return;
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        previewObjectUrl.current = objectUrl;
        setPreviewUrl(objectUrl);
        return;
      }
      const payload = (await response.json()) as { id?: string; reportReference?: string };
      setMessage(payload.reportReference ? `${payload.reportReference} saved.` : "Report saved.");
      router.refresh();
      if (payload.id) {
        window.location.assign(`/api/admin/installations/reports/${payload.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-neutral-950">Completion report</h4>
        <p className="text-sm text-neutral-600">
          {installationReportScopeStatement(visit.visitNumber, PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] || project.status)}
        </p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-neutral-500">Customer</dt>
          <dd>{project.companyName}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Job and quote</dt>
          <dd>{[project.jobReference || "No job number", quote || "No quote reference"].join(" · ")}</dd>
        </div>
      </dl>
      <div className="space-y-2 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Checklist</p>
        <p>{checklist.siteLeftSafeAndTidy ? "Confirmed" : "Not confirmed"} · {COMPLETION_CHECKLIST[0]}</p>
        <p>{checklist.installationPhotosRecorded ? "Confirmed" : "Not confirmed"} · {COMPLETION_CHECKLIST[1]}</p>
        <p className="text-neutral-600">
          {visit.signOffCapturedByName && visit.signOffAt
            ? `Recorded by ${visit.signOffCapturedByName} · ${formatLondonWhen(visit.signOffAt)}`
            : "No checklist confirmation was recorded."}
        </p>
      </div>
      <p className="text-sm text-neutral-700">{installationReportSnagStatement(outstanding, visit.snags.length)}</p>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Photographs</p>
        {grouped.map((group) => (
          <div key={group.phase} className="space-y-2">
            <p className="text-sm font-medium text-neutral-800">{group.label}</p>
            {group.photos.length === 0 ? (
              <p className="text-sm text-neutral-600">No {group.label.toLowerCase()} photographs.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.photos.map((photo) => {
                  const included = selected.includes(photo.id);
                  return (
                    <label key={photo.id} className="overflow-hidden rounded-lg border border-neutral-200 text-xs">
                      {photo.url ? <img src={photo.url} alt={photo.name} className="h-24 w-full object-cover" /> : null}
                      <span className="flex min-h-11 items-center gap-2 px-2">
                        <input
                          type="checkbox"
                          checked={included}
                          onChange={() =>
                            setSelected((current) =>
                              current.includes(photo.id) ? current.filter((id) => id !== photo.id) : [...current, photo.id]
                            )
                          }
                        />
                        Include
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      {message ? <p className="text-sm text-neutral-700">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void requestReport(false)}>
          Preview PDF
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={busy || !canSaveOfficialReport}
          onClick={() => void requestReport(true)}
        >
          Save and download
        </Button>
      </div>
      <p className="text-xs text-neutral-500">
        {canSaveOfficialReport
          ? "Publish a saved report before customers can access it. Sending email is a separate manager action."
          : "Record the visit sign-off before saving an official report. Preview remains available."}
      </p>
      {previewUrl ? (
        <iframe title="Completion report preview" src={previewUrl} className="h-[70vh] w-full rounded-lg border border-neutral-200" />
      ) : null}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Report history</p>
        {visit.reports.length === 0 ? (
          <p className="text-sm text-neutral-600">No completion reports have been saved for this visit.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {visit.reports.map((report) => (
              <li key={report.id} className="rounded-lg border border-neutral-200 px-3 py-2">
                <a className="inline-flex min-h-11 items-center font-medium underline" href={`/api/admin/installations/reports/${report.id}`}>
                  {report.reportReference}
                </a>
                <p className="text-xs text-neutral-500">
                  Version {report.versionNumber}
                  {report.generatedAt ? ` · ${formatLondonWhen(report.generatedAt)}` : ""}
                  {report.generatedByName ? ` · ${report.generatedByName}` : ""}
                  {report.isPublished ? " · Published" : ""}
                </p>
                <InstallationReportCustomerActions
                  report={report}
                  visitPublishedReportId={visit.publishedReport?.reportId ?? null}
                />
              </li>
            ))}
          </ul>
        )}
        <InstallationVisitPublicationHistory
          visitId={visit.id}
          sampleReportId={visit.reports[0]?.id ?? null}
        />
      </div>
    </section>
  );
}
