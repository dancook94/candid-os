"use client";

import { useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INSTALLATION_PHOTO_PHASES,
  INSTALLATION_PROJECT_STATUSES,
  INSTALLATION_FILES_BUCKET,
} from "@/lib/installations/constants";
import { asConflicts, conflictSummary, type ScheduleConflict } from "@/lib/installations/conflicts";
import { isOutstandingInstallationSnag } from "@/lib/installations/job-signal";
import { PROJECT_STATUS_LABELS, VISIT_STATUS_LABELS, formatLondonWhen } from "@/lib/installations/labels";
import type {
  InstallationFile,
  InstallationProjectRecord,
  InstallationSnag,
  InstallationVisitRecord,
  InstallerOption,
} from "@/lib/installations/queries";
import { buildInstallationDocumentPath, buildInstallationPhotoPath } from "@/lib/installations/storage";
import { createClient } from "@/lib/supabase/client";

type CommitResult = {
  saved: boolean;
  conflicts: ScheduleConflict[];
  unfinishedVisits: number;
  openSnags: number;
  error: string | null;
};

function readResult(data: unknown, error: { message: string } | null): CommitResult {
  if (error) {
    return { saved: false, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: error.message };
  }

  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    saved: row.saved === true,
    conflicts: asConflicts(row.conflicts),
    unfinishedVisits: Number(row.unfinished_visits ?? 0),
    openSnags: Number(row.open_snags ?? 0),
    error: null,
  };
}

function toLocalInput(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function InstallationProjectPanel({
  project,
  installers,
  canManage,
  canOperate,
}: {
  project: InstallationProjectRecord;
  installers: InstallerOption[];
  canManage: boolean;
  canOperate: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<CommitResult>) {
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);

    if (result.error) {
      setMessage(result.error);
      return result;
    }

    if (!result.saved) {
      setMessage(
        result.conflicts.length > 0
          ? "This booking clashes with an existing commitment. Review it and confirm if you still want to save."
          : "Confirm the warning before completing this project."
      );
      return result;
    }

    router.refresh();
    return result;
  }

  return (
    <div className="space-y-6">
      {message ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {message}
        </p>
      ) : null}

      {canManage ? (
        <ProjectDetailsForm project={project} busy={busy} onSave={run} />
      ) : (
        <p className="text-sm text-neutral-600">{project.description || "No installation instructions yet."}</p>
      )}

      {canManage ? <CreateVisitForm projectId={project.id} busy={busy} onSave={run} /> : null}

      <div className="space-y-4">
        {project.visits.map((visit) => (
          <VisitCard
            key={visit.id}
            visit={visit}
            installers={installers}
            artwork={project.artwork}
            jobId={project.jobId}
            unfinishedVisits={project.visits.filter(
              (item) => !["completed", "cancelled"].includes(item.status)
            ).length}
            canManage={canManage}
            canOperate={canOperate}
            busy={busy}
            onSave={run}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectDetailsForm({
  project,
  busy,
  onSave,
}: {
  project: InstallationProjectRecord;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description || "");
  const [status, setStatus] = useState(project.status);
  const [warning, setWarning] = useState<CommitResult | null>(null);

  async function save(acknowledge: boolean) {
    const result = await onSave(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("installation_project_update_details", {
        p_project_id: project.id,
        p_title: title,
        p_description: description.trim() || null,
        p_status: status,
        p_acknowledge_completion: acknowledge,
      });
      return readResult(data, error);
    });

    setWarning(result.saved ? null : result);
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <h2 className="text-base font-semibold text-neutral-950">Project</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="project-title">Title</Label>
          <Input id="project-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-status">Project status</Label>
          <select
            id="project-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm"
          >
            {INSTALLATION_PROJECT_STATUSES.map((item) => (
              <option key={item} value={item}>
                {PROJECT_STATUS_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="project-instructions">Installation instructions</Label>
        <textarea
          id="project-instructions"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      {warning && !warning.saved && (warning.unfinishedVisits > 0 || warning.openSnags > 0) ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>
            This project still has {warning.unfinishedVisits} unfinished visit
            {warning.unfinishedVisits === 1 ? "" : "s"} and {warning.openSnags} open snag
            {warning.openSnags === 1 ? "" : "s"}. Completing it does not complete those visits.
          </p>
          <Button type="button" disabled={busy} onClick={() => void save(true)}>
            Complete project anyway
          </Button>
        </div>
      ) : null}
      <Button type="submit" disabled={busy}>
        Save project
      </Button>
    </form>
  );
}

function CreateVisitForm({
  projectId,
  busy,
  onSave,
}: {
  projectId: string;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [title, setTitle] = useState("");

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(async () => {
          const supabase = createClient();
          const { error } = await supabase.rpc("installation_visit_create_admin", {
            p_project_id: projectId,
            p_title: title,
            p_purpose: null,
          });
          if (error) {
            return readResult(null, error);
          }
          setTitle("");
          return { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="new-visit-title">Additional visit</Label>
        <Input
          id="new-visit-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Return visit"
        />
      </div>
      <Button type="submit" variant="outline" disabled={busy || title.trim().length === 0}>
        Add visit
      </Button>
    </form>
  );
}

function VisitCard({
  visit,
  installers,
  artwork,
  jobId,
  unfinishedVisits,
  canManage,
  canOperate,
  busy,
  onSave,
}: {
  visit: InstallationVisitRecord;
  installers: InstallerOption[];
  artwork: InstallationProjectRecord["artwork"];
  jobId: string | null;
  unfinishedVisits: number;
  canManage: boolean;
  canOperate: boolean;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const statusLabel = VISIT_STATUS_LABELS[visit.status as keyof typeof VISIT_STATUS_LABELS] || visit.status;
  const address = [
    visit.siteAddressLine1,
    visit.siteAddressLine2,
    visit.siteCity,
    visit.siteCounty,
    visit.sitePostcode,
  ].filter(Boolean);
  const contact = [visit.onSiteContactName || visit.siteRecipientName, visit.onSiteContactPhone || visit.sitePhone]
    .filter(Boolean)
    .join(" · ");
  const outstandingSnags = visit.snags.filter((snag) => isOutstandingInstallationSnag(snag.status)).length;

  return (
    <article className="space-y-6 rounded-xl border border-neutral-200 bg-white p-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-neutral-950">
              Visit {visit.visitNumber}: {visit.title}
            </h3>
            <p className="text-sm text-neutral-600">Visit details and installers</p>
          </div>
          <p className="text-sm font-medium text-neutral-800">{statusLabel}</p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-neutral-500">Site address</dt>
            <dd className="mt-1 text-neutral-900">{address.join(", ") || "Site not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Site contact</dt>
            <dd className="mt-1 text-neutral-900">{contact || "Contact not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Visit date and time</dt>
            <dd className="mt-1 text-neutral-900">{formatLondonWhen(visit.scheduledStartAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Assigned installers</dt>
            <dd className="mt-1 text-neutral-900">
              {visit.assignees.length > 0 ? visit.assignees.map((person) => person.name).join(", ") : "No installers"}
            </dd>
          </div>
        </dl>
        {visit.accessInstructions ? (
          <p className="text-sm text-neutral-700">Instructions: {visit.accessInstructions}</p>
        ) : null}
        {visit.internalNotes ? (
          <p className="text-sm text-neutral-700">Notes: {visit.internalNotes}</p>
        ) : null}
        <p className="text-sm text-neutral-600">
          Completing this visit does not complete the installation project.
        </p>
        {canOperate && !["completed", "cancelled"].includes(visit.status) ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["en_route", "on_site", "completed", "failed"] as const).map((status) => (
              <Button
                key={status}
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  void onSave(async () => {
                    const supabase = createClient();
                    const { error } = await supabase.rpc("installation_visit_operational_progress", {
                      p_visit_id: visit.id,
                      p_status: status,
                      p_actual_start_at: status === "on_site" ? new Date().toISOString() : null,
                      p_actual_end_at: status === "completed" ? new Date().toISOString() : null,
                      p_internal_notes: null,
                      p_completion_notes: null,
                    });
                    return error
                      ? readResult(null, error)
                      : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
                  })
                }
              >
                {VISIT_STATUS_LABELS[status]}
              </Button>
            ))}
          </div>
        ) : null}
        {canManage ? <ScheduleForm visit={visit} busy={busy} onSave={onSave} /> : null}
        {canManage ? (
          <AssignForm visit={visit} installers={installers} busy={busy} onSave={onSave} />
        ) : null}
        {canManage && ["completed", "cancelled"].includes(visit.status) ? (
          <ReopenForm visitId={visit.id} busy={busy} onSave={onSave} />
        ) : null}
      </section>

      <section className="space-y-3 border-t border-neutral-100 pt-4">
        <h4 className="text-sm font-semibold text-neutral-950">Installation photos</h4>
        {INSTALLATION_PHOTO_PHASES.map((phase) => (
          <PhotoGallery key={phase} phase={phase} photos={visit.photos.filter((photo) => photo.kind === phase)} />
        ))}
        {canOperate ? <PhotoForm visitId={visit.id} busy={busy} onSave={onSave} /> : null}
      </section>

      <section className="space-y-3 border-t border-neutral-100 pt-4">
        <h4 className="text-sm font-semibold text-neutral-950">Snagging</h4>
        {visit.snags.map((snag) => (
          <SnagCard
            key={snag.id}
            visitId={visit.id}
            snag={snag}
            installers={installers}
            canOperate={canOperate}
            busy={busy}
            onSave={onSave}
          />
        ))}
        {canOperate ? <SnagForm visit={visit} installers={installers} busy={busy} onSave={onSave} /> : null}
      </section>

      <section className="space-y-3 border-t border-neutral-100 pt-4">
        <h4 className="text-sm font-semibold text-neutral-950">Documents and artwork</h4>
        {canOperate ? <DocumentForm visitId={visit.id} busy={busy} onSave={onSave} /> : null}
        {visit.documents.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {visit.documents.map((document) => (
              <li key={document.id}>
                {document.url ? (
                  <a className="inline-flex min-h-11 items-center underline" href={document.url}>
                    {document.name}
                  </a>
                ) : (
                  document.name
                )}
                <span className="text-neutral-500"> · {document.kind}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-600">No installation documents yet.</p>
        )}
        <div className="space-y-1">
          <p className="text-xs text-neutral-500">Linked job artwork</p>
          {artwork.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {artwork.map((file) => (
                <li key={file.id}>{file.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-600">No job artwork is linked.</p>
          )}
          {jobId ? (
            <a className="inline-flex min-h-11 items-center text-sm underline" href={`/admin/jobs/${jobId}`}>
              Open job artwork
            </a>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 border-t border-neutral-100 pt-4">
        <h4 className="text-sm font-semibold text-neutral-950">Completion and sign-off</h4>
        {outstandingSnags > 0 || unfinishedVisits > 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {outstandingSnags > 0
              ? `${outstandingSnags} outstanding snag${outstandingSnags === 1 ? "" : "s"} remain. `
              : ""}
            {unfinishedVisits > 0
              ? `${unfinishedVisits} visit${unfinishedVisits === 1 ? "" : "s"} still unfinished. `
              : ""}
            Signing off this visit does not complete the installation project.
          </p>
        ) : null}
        {visit.signOffName ? (
          <p className="text-sm text-neutral-700">
            Signed by {visit.signOffName}
            {visit.signOffAt ? ` · ${formatLondonWhen(visit.signOffAt)}` : ""}
          </p>
        ) : canOperate ? (
          <SignOffForm visitId={visit.id} busy={busy} onSave={onSave} />
        ) : (
          <p className="text-sm text-neutral-600">No customer sign-off recorded.</p>
        )}
      </section>
    </article>
  );
}

function ScheduleForm({
  visit,
  busy,
  onSave,
}: {
  visit: InstallationVisitRecord;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [start, setStart] = useState(toLocalInput(visit.scheduledStartAt));
  const [end, setEnd] = useState(toLocalInput(visit.scheduledEndAt));
  const [status, setStatus] = useState(
    visit.status === "cancelled" ? "cancelled" : visit.scheduledStartAt ? "scheduled" : "unscheduled"
  );
  const [address, setAddress] = useState(visit.siteAddressLine1 || "");
  const [city, setCity] = useState(visit.siteCity || "");
  const [postcode, setPostcode] = useState(visit.sitePostcode || "");
  const [contact, setContact] = useState(visit.onSiteContactName || "");
  const [phone, setPhone] = useState(visit.onSiteContactPhone || "");
  const [instructions, setInstructions] = useState(visit.accessInstructions || "");
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);

  async function save(acknowledge: boolean) {
    const result = await onSave(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("installation_visit_commit_schedule", {
        p_visit_id: visit.id,
        p_status: status,
        p_scheduled_start_at: fromLocalInput(start),
        p_scheduled_end_at: fromLocalInput(end),
        p_title: visit.title,
        p_purpose: visit.purpose,
        p_site_label: visit.siteLabel,
        p_site_recipient_name: visit.siteRecipientName,
        p_site_address_line_1: address || null,
        p_site_address_line_2: visit.siteAddressLine2,
        p_site_city: city || null,
        p_site_county: visit.siteCounty,
        p_site_postcode: postcode || null,
        p_site_country: visit.siteCountry || "GB",
        p_site_phone: visit.sitePhone,
        p_access_instructions: instructions || null,
        p_on_site_contact_name: contact || null,
        p_on_site_contact_phone: phone || null,
        p_acknowledge: acknowledge,
      });
      return readResult(data, error);
    });
    setConflicts(result.saved ? [] : result.conflicts);
  }

  return (
    <form
      className="space-y-3 border-t border-neutral-100 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <h4 className="text-sm font-medium text-neutral-950">Schedule</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm"
          >
            <option value="unscheduled">Unscheduled</option>
            <option value="scheduled">Scheduled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          Start
          <Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          End
          <Input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address" />
        <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" />
        <Input value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="Postcode" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="On-site contact" />
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Contact phone" />
      </div>
      <textarea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        rows={2}
        placeholder="Access instructions"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      {conflicts.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <ul className="list-disc space-y-1 pl-4">
            {conflicts.map((conflict, index) => (
              <li key={`${conflict.kind}-${conflict.profile_id}-${index}`}>{conflictSummary(conflict)}</li>
            ))}
          </ul>
          <Button type="button" disabled={busy} onClick={() => void save(true)}>
            Save and acknowledge conflicts
          </Button>
        </div>
      ) : null}
      <Button type="submit" disabled={busy}>
        Save visit
      </Button>
    </form>
  );
}

function AssignForm({
  visit,
  installers,
  busy,
  onSave,
}: {
  visit: InstallationVisitRecord;
  installers: InstallerOption[];
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const assigned = new Set(visit.assignees.map((person) => person.profileId));
  const [selected, setSelected] = useState<string[]>(visit.assignees.map((person) => person.profileId));
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);

  async function save(acknowledge: boolean) {
    const result = await onSave(async () => {
      const supabase = createClient();
      const added = selected.filter((id) => !assigned.has(id));
      const removed = visit.assignees.map((person) => person.profileId).filter((id) => !selected.includes(id));
      let pending: ScheduleConflict[] = [];

      for (const profileId of removed) {
        const { error } = await supabase.rpc("installation_visit_assign_confirmed", {
          p_visit_id: visit.id,
          p_profile_id: profileId,
          p_remove: true,
          p_acknowledge: true,
        });
        if (error) {
          return readResult(null, error);
        }
      }

      for (const profileId of added) {
        const { data, error } = await supabase.rpc("installation_visit_assign_confirmed", {
          p_visit_id: visit.id,
          p_profile_id: profileId,
          p_remove: false,
          p_acknowledge: acknowledge,
        });
        const parsed = readResult(data, error);
        if (parsed.error || !parsed.saved) {
          pending = parsed.conflicts;
          return parsed;
        }
      }

      return { saved: true, conflicts: pending, unfinishedVisits: 0, openSnags: 0, error: null };
    });
    setConflicts(result.saved ? [] : result.conflicts);
  }

  return (
    <form
      className="space-y-2 border-t border-neutral-100 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <h4 className="text-sm font-medium text-neutral-950">Installers</h4>
      <div className="flex flex-wrap gap-2">
        {installers.map((installer) => {
          const checked = selected.includes(installer.id);
          return (
            <label key={installer.id} className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, installer.id]
                      : current.filter((id) => id !== installer.id)
                  )
                }
              />
              {installer.name}
            </label>
          );
        })}
      </div>
      {conflicts.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <ul className="list-disc space-y-1 pl-4">
            {conflicts.map((conflict, index) => (
              <li key={`${conflict.profile_id}-${index}`}>{conflictSummary(conflict)}</li>
            ))}
          </ul>
          <Button type="button" disabled={busy} onClick={() => void save(true)}>
            Assign and acknowledge conflicts
          </Button>
        </div>
      ) : null}
      <Button type="submit" variant="outline" disabled={busy}>
        Save installers
      </Button>
    </form>
  );
}

function ReopenForm({
  visitId,
  busy,
  onSave,
}: {
  visitId: string;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [reason, setReason] = useState("");

  return (
    <form
      className="flex flex-col gap-2 border-t border-neutral-100 pt-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(async () => {
          const supabase = createClient();
          const { error } = await supabase.rpc("installation_visit_manager_reopen", {
            p_visit_id: visitId,
            p_reason: reason,
            p_target_status: "scheduled",
          });
          return error
            ? readResult(null, error)
            : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason to reopen" />
      <Button type="submit" variant="outline" disabled={busy || reason.trim().length === 0}>
        Reopen visit
      </Button>
    </form>
  );
}

const SNAG_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
] as const;

function snagStatusLabel(status: string) {
  return SNAG_STATUS_OPTIONS.find((option) => option.value === status)?.label || status;
}

function PhotoGallery({ phase, photos }: { phase: string; photos: InstallationFile[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{phase}</p>
      {photos.length === 0 ? (
        <p className="text-sm text-neutral-600">No {phase} photos.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo) => (
            <figure key={photo.id} className="overflow-hidden rounded-lg border border-neutral-200">
              {photo.url ? (
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img src={photo.url} alt={photo.name} className="h-28 w-full object-cover" />
                </a>
              ) : (
                <div className="flex h-28 items-center justify-center px-2 text-xs text-neutral-500">{photo.name}</div>
              )}
              <figcaption className="px-2 py-1 text-xs text-neutral-600">{photo.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function SnagPhotos({ photos, empty }: { photos: InstallationFile[]; empty: string }) {
  if (photos.length === 0) {
    return <p className="text-xs text-neutral-500">{empty}</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map((photo) =>
        photo.url ? (
          <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
            <img src={photo.url} alt={photo.name} className="h-20 w-full rounded object-cover" />
          </a>
        ) : (
          <span key={photo.id} className="text-xs text-neutral-500">
            {photo.name}
          </span>
        )
      )}
    </div>
  );
}

function SnagCard({
  visitId,
  snag,
  installers,
  canOperate,
  busy,
  onSave,
}: {
  visitId: string;
  snag: InstallationSnag;
  installers: InstallerOption[];
  canOperate: boolean;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [status, setStatus] = useState(snag.status === "wont_fix" ? "resolved" : snag.status);
  const [assigned, setAssigned] = useState(snag.assignedToProfileId || "");
  const [notes, setNotes] = useState(snag.resolutionNotes || "");
  const responsible =
    installers.find((person) => person.id === snag.assignedToProfileId)?.name || "Unassigned";

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-neutral-950">{snag.description}</p>
        <span className="text-xs font-medium text-neutral-600">{snagStatusLabel(snag.status)}</span>
      </div>
      <p className="text-xs text-neutral-500">Responsible: {responsible}</p>
      <div>
        <p className="text-xs text-neutral-500">Issue photos</p>
        <SnagPhotos photos={snag.issuePhotos} empty="No issue photos." />
      </div>
      <div>
        <p className="text-xs text-neutral-500">Resolution photos</p>
        <SnagPhotos photos={snag.resolutionPhotos} empty="No resolution photos." />
      </div>
      {snag.resolutionNotes ? (
        <p className="text-sm text-neutral-700">Resolution notes: {snag.resolutionNotes}</p>
      ) : null}
      {canOperate ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(async () => {
              const supabase = createClient();
              const { error } = await supabase.rpc("installation_snag_upsert", {
                p_visit_id: visitId,
                p_snag_id: snag.id,
                p_description: snag.description,
                p_status: status,
                p_resolution_notes: notes.trim() || null,
                p_assigned_profile_id: assigned || null,
              });
              return error
                ? readResult(null, error)
                : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
            });
          }}
        >
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="min-h-11 rounded-lg border border-neutral-300 px-2 text-sm"
            aria-label="Snag status"
          >
            {SNAG_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={assigned}
            onChange={(event) => setAssigned(event.target.value)}
            className="min-h-11 rounded-lg border border-neutral-300 px-2 text-sm"
            aria-label="Responsible person"
          >
            <option value="">Responsible person</option>
            {installers.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Resolution notes"
          />
          <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>
            Save snag
          </Button>
        </form>
      ) : null}
      {canOperate ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <SnagPhotoForm visitId={visitId} snagId={snag.id} role="issue" busy={busy} onSave={onSave} />
          <SnagPhotoForm visitId={visitId} snagId={snag.id} role="resolution" busy={busy} onSave={onSave} />
        </div>
      ) : null}
    </div>
  );
}

function SnagPhotoForm({
  visitId,
  snagId,
  role,
  busy,
  onSave,
}: {
  visitId: string;
  snagId: string;
  role: "issue" | "resolution";
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const file = (event.currentTarget.elements.namedItem("photo") as HTMLInputElement).files?.[0];
        if (!file) {
          return;
        }
        void onSave(async () => {
          const supabase = createClient();
          const phase = role === "issue" ? "during" : "after";
          const path = buildInstallationPhotoPath(visitId, phase, file.name);
          const upload = await supabase.storage.from(INSTALLATION_FILES_BUCKET).upload(path, file, {
            contentType: file.type,
          });
          if (upload.error) {
            return readResult(null, upload.error);
          }
          const { error } = await supabase.rpc("installation_register_snag_photo", {
            p_visit_id: visitId,
            p_snag_id: snagId,
            p_role: role,
            p_storage_path: path,
            p_file_name: file.name,
            p_mime_type: file.type,
            p_byte_size: file.size,
          });
          return error
            ? readResult(null, error)
            : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <Label className="text-xs">{role === "issue" ? "Add issue photo" : "Add resolution photo"}</Label>
      <Input name="photo" type="file" accept="image/*" capture="environment" className="min-h-11" />
      <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>
        Upload
      </Button>
    </form>
  );
}

function SnagForm({
  visit,
  installers,
  busy,
  onSave,
}: {
  visit: InstallationVisitRecord;
  installers: InstallerOption[];
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [description, setDescription] = useState("");
  const [assigned, setAssigned] = useState("");

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(async () => {
          const supabase = createClient();
          const { error } = await supabase.rpc("installation_snag_upsert", {
            p_visit_id: visit.id,
            p_snag_id: null,
            p_description: description,
            p_status: "open",
            p_resolution_notes: null,
            p_assigned_profile_id: assigned || null,
          });
          if (!error) {
            setDescription("");
          }
          return error
            ? readResult(null, error)
            : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Snag description" />
      <select
        value={assigned}
        onChange={(event) => setAssigned(event.target.value)}
        className="min-h-11 rounded-lg border border-neutral-300 px-2 text-sm"
        aria-label="Responsible person"
      >
        <option value="">Responsible person</option>
        {installers.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" className="min-h-11" disabled={busy || description.trim().length === 0}>
        Add snag
      </Button>
    </form>
  );
}

function PhotoForm({
  visitId,
  busy,
  onSave,
}: {
  visitId: string;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const [phase, setPhase] = useState<(typeof INSTALLATION_PHOTO_PHASES)[number]>("before");

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        const file = (event.currentTarget.elements.namedItem("photo") as HTMLInputElement).files?.[0];
        if (!file) {
          return;
        }
        void onSave(async () => {
          const supabase = createClient();
          const path = buildInstallationPhotoPath(visitId, phase, file.name);
          const upload = await supabase.storage.from(INSTALLATION_FILES_BUCKET).upload(path, file, {
            contentType: file.type,
          });
          if (upload.error) {
            return readResult(null, upload.error);
          }
          const { error } = await supabase.rpc("installation_register_visit_photo", {
            p_visit_id: visitId,
            p_phase: phase,
            p_storage_path: path,
            p_file_name: file.name,
            p_mime_type: file.type,
            p_byte_size: file.size,
            p_captured_at: new Date().toISOString(),
          });
          return error
            ? readResult(null, error)
            : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <select
        value={phase}
        onChange={(event) => setPhase(event.target.value as (typeof INSTALLATION_PHOTO_PHASES)[number])}
        className="h-9 rounded-lg border border-neutral-300 px-2 text-sm"
      >
        {INSTALLATION_PHOTO_PHASES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <Input name="photo" type="file" accept="image/*" capture="environment" className="min-h-11" />
      <Button type="submit" variant="outline" disabled={busy}>
        Upload photo
      </Button>
    </form>
  );
}

function DocumentForm({
  visitId,
  busy,
  onSave,
}: {
  visitId: string;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        const file = (event.currentTarget.elements.namedItem("document") as HTMLInputElement).files?.[0];
        if (!file) {
          return;
        }
        void onSave(async () => {
          const supabase = createClient();
          const path = buildInstallationDocumentPath(visitId, "other", file.name);
          const upload = await supabase.storage.from(INSTALLATION_FILES_BUCKET).upload(path, file, {
            contentType: file.type || "application/octet-stream",
          });
          if (upload.error) {
            return readResult(null, upload.error);
          }
          const { error } = await supabase.rpc("installation_register_visit_document", {
            p_visit_id: visitId,
            p_document_kind: "other",
            p_storage_path: path,
            p_file_name: file.name,
            p_mime_type: file.type || "application/octet-stream",
            p_byte_size: file.size,
            p_linked_job_file_id: null,
          });
          return error
            ? readResult(null, error)
            : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <Input name="document" type="file" />
      <Button type="submit" variant="outline" disabled={busy}>
        Upload document
      </Button>
    </form>
  );
}

const SIGN_OFF_CHECKS = [
  "Site left safe",
  "Installation photos recorded",
  "Customer present for sign-off",
] as const;

function SignOffForm({
  visitId,
  busy,
  onSave,
}: {
  visitId: string;
  busy: boolean;
  onSave: (action: () => Promise<CommitResult>) => Promise<CommitResult>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [name, setName] = useState("");
  const [checks, setChecks] = useState<boolean[]>(SIGN_OFF_CHECKS.map(() => false));
  const [signed, setSigned] = useState(false);

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    if (event.type === "pointerdown") {
      context.beginPath();
      context.moveTo(x, y);
      setSigned(true);
      return;
    }
    if (event.buttons !== 1) {
      return;
    }
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#171717";
    context.lineTo(x, y);
    context.stroke();
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas || !signed || checks.some((checked) => !checked)) {
          return;
        }
        void onSave(async () => {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
          if (!blob) {
            return {
              saved: false,
              conflicts: [],
              unfinishedVisits: 0,
              openSnags: 0,
              error: "The signature could not be captured.",
            };
          }
          const supabase = createClient();
          const path = buildInstallationDocumentPath(visitId, "other", "customer-signature.png");
          const upload = await supabase.storage.from(INSTALLATION_FILES_BUCKET).upload(path, blob, {
            contentType: "image/png",
          });
          if (upload.error) {
            return readResult(null, upload.error);
          }
          const { error } = await supabase.rpc("installation_sign_off_capture", {
            p_visit_id: visitId,
            p_customer_name: name,
            p_notes: `Checklist confirmed: ${SIGN_OFF_CHECKS.join(", ")}.`,
            p_signature_storage_path: path,
          });
          return error
            ? readResult(null, error)
            : { saved: true, conflicts: [], unfinishedVisits: 0, openSnags: 0, error: null };
        });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-neutral-800">Completion checklist</legend>
        {SIGN_OFF_CHECKS.map((label, index) => (
          <label key={label} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checks[index]}
              onChange={(event) =>
                setChecks((current) => current.map((value, item) => (item === index ? event.target.checked : value)))
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer name" />
      <div>
        <Label>Customer signature</Label>
        <canvas
          ref={canvasRef}
          width={600}
          height={180}
          className="mt-1 h-36 w-full touch-none rounded-lg border border-neutral-300 bg-white"
          onPointerDown={draw}
          onPointerMove={draw}
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="min-h-11"
        disabled={busy || name.trim().length === 0 || !signed || checks.some((checked) => !checked)}
      >
        Record sign-off
      </Button>
    </form>
  );
}
