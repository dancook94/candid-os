"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  PROOF_ARTWORK_ORIGIN_LABELS,
  PROOF_BYPASS_REASONS,
  PROOF_BYPASS_REASON_LABELS,
  PROOF_INTERNAL_CHECKLIST_KEYS,
  PROOF_INTERNAL_CHECKLIST_LABELS,
  PROOF_STATUS_LABELS,
  PROOF_WORKFLOW_STATUS_LABELS,
  type ProofArtworkOrigin,
  type ProofBypassReason,
} from "@/lib/proofs/constants";
import type { JobProofView } from "@/lib/proofs/types";
import type { ManifestItemRecord } from "@/lib/manifest/types";

type AdminJobProofsPanelProps = {
  jobId: string;
  manifestItems: ManifestItemRecord[];
  jobFiles: Array<{ id: string; file_name: string; upload_status: string }>;
  initialRequirement: {
    proofRequired: boolean;
    workflowStatus: string;
    bypassReason: string | null;
  };
  initialProofs: JobProofView[];
  schemaMissing?: boolean;
};

function mapProofStatusToBadge(status: string) {
  switch (status) {
    case "approved":
      return "approved" as const;
    case "sent":
    case "viewed":
      return "sent" as const;
    case "changes_requested":
      return "pending" as const;
    case "superseded":
    case "cancelled":
      return "draft" as const;
    default:
      return "pending" as const;
  }
}

export function AdminJobProofsPanel({
  jobId,
  manifestItems,
  jobFiles,
  initialRequirement,
  initialProofs,
  schemaMissing,
}: AdminJobProofsPanelProps) {
  const [proofRequired, setProofRequired] = useState(initialRequirement.proofRequired);
  const [workflowStatus, setWorkflowStatus] = useState(initialRequirement.workflowStatus);
  const [proofs, setProofs] = useState(initialProofs);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [bypassReason, setBypassReason] = useState<ProofBypassReason>("repeat_job_previously_approved");

  const [title, setTitle] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [artworkOrigin, setArtworkOrigin] = useState<ProofArtworkOrigin>("customer_uploaded");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [sourceJobFileId, setSourceJobFileId] = useState("");
  const [dropboxSourcePath, setDropboxSourcePath] = useState("");
  const [dropboxFiles, setDropboxFiles] = useState<
    Array<{ id: string; name: string; path: string; size: number }>
  >([]);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const activeItems = useMemo(
    () => manifestItems.filter((item) => !item.deleted_at && !item.combined_into_item_id),
    [manifestItems]
  );

  const completeJobFiles = jobFiles.filter((file) => file.upload_status === "complete");

  async function refreshProofs() {
    const response = await fetch(`/api/admin/jobs/${jobId}/proof-requirement`);
    const payload = (await response.json()) as {
      requirement?: {
        proofRequired: boolean;
        workflowStatus: string;
      };
      proofs?: JobProofView[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Unable to refresh proofs.");
      return;
    }

    if (payload.requirement) {
      setProofRequired(payload.requirement.proofRequired);
      setWorkflowStatus(payload.requirement.workflowStatus);
    }

    if (payload.proofs) {
      setProofs(payload.proofs);
    }
  }

  async function updateProofRequirement(nextRequired: boolean) {
    setError(null);
    setPending(true);

    const response = await fetch(`/api/admin/jobs/${jobId}/proof-requirement`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proofRequired: nextRequired,
        bypassReason: nextRequired ? undefined : bypassReason,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to update proof requirement.");
      return;
    }

    await refreshProofs();
  }

  async function loadDropboxFiles(origin: ProofArtworkOrigin) {
    setError(null);
    const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artworkOrigin: origin }),
    });

    const payload = (await response.json()) as {
      files?: Array<{ id: string; name: string; path: string; size: number }>;
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Unable to load Dropbox files.");
      return;
    }

    setDropboxFiles(payload.files ?? []);
  }

  async function createProof() {
    setError(null);
    setPending(true);

    const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        artworkOrigin,
        customerMessage,
        internalNote,
        productionItemIds: selectedItemIds,
        sourceJobFileId: sourceJobFileId || undefined,
        dropboxSourcePath: dropboxSourcePath || undefined,
        dropboxFileName: dropboxFiles.find((file) => file.path === dropboxSourcePath)?.name,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to create proof.");
      return;
    }

    setShowCreate(false);
    setTitle("");
    setCustomerMessage("");
    setInternalNote("");
    setSelectedItemIds([]);
    setSourceJobFileId("");
    setDropboxSourcePath("");
    await refreshProofs();
  }

  async function proofAction(proofId: string, action: string, extra?: Record<string, unknown>) {
    setError(null);
    setPending(true);

    const response = await fetch(`/api/admin/jobs/${jobId}/proofs/${proofId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });

    const payload = (await response.json()) as { error?: string };
    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Proof action failed.");
      return;
    }

    await refreshProofs();
    window.location.reload();
  }

  if (schemaMissing) {
    return (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Proofs</h2>
        <p className="text-sm text-muted-foreground">
          Proofing schema is not deployed. Apply migration{" "}
          <code className="text-xs">20260822130000_job_proofing_phase1.sql</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Proofs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage proof requirement, versions, internal review, and customer approval.
          </p>
        </div>
        {proofRequired ? (
          <Button type="button" onClick={() => setShowCreate(true)} disabled={pending}>
            + Create proof
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Proof requirement</p>
            <p className="mt-1 font-medium">{proofRequired ? "Required" : "Not required"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Proof status</p>
            <p className="mt-1 font-medium">
              {PROOF_WORKFLOW_STATUS_LABELS[
                workflowStatus as keyof typeof PROOF_WORKFLOW_STATUS_LABELS
              ] ?? workflowStatus}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {proofRequired ? (
            <>
              <div className="w-full space-y-2">
                <Label htmlFor="bypassReason">Bypass reason</Label>
                <select
                  id="bypassReason"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={bypassReason}
                  onChange={(event) =>
                    setBypassReason(event.target.value as ProofBypassReason)
                  }
                >
                  {PROOF_BYPASS_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {PROOF_BYPASS_REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => updateProofRequirement(false)}
              >
                Bypass proof
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => updateProofRequirement(true)}
            >
              Require proof
            </Button>
          )}
        </div>

        {!proofRequired && initialRequirement.bypassReason ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Bypass reason: {initialRequirement.bypassReason}
          </p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {showCreate ? (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <h3 className="font-semibold">Create proof</h3>

          <div className="space-y-2">
            <Label>Manifest items</Label>
            <div className="space-y-2">
              {activeItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={(event) => {
                      setSelectedItemIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id)
                      );
                    }}
                  />
                  <span>
                    {item.item_reference ? `${item.item_reference} · ` : ""}
                    {item.item_name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="artworkOrigin">Artwork source</Label>
            <select
              id="artworkOrigin"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={artworkOrigin}
              onChange={async (event) => {
                const origin = event.target.value as ProofArtworkOrigin;
                setArtworkOrigin(origin);
                setDropboxSourcePath("");
                if (origin === "candid_created") {
                  await loadDropboxFiles(origin);
                }
              }}
            >
              {Object.entries(PROOF_ARTWORK_ORIGIN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {artworkOrigin === "customer_uploaded" || artworkOrigin === "existing_repeat" ? (
            <div className="space-y-2">
              <Label htmlFor="sourceJobFileId">Customer artwork file</Label>
              <select
                id="sourceJobFileId"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={sourceJobFileId}
                onChange={(event) => setSourceJobFileId(event.target.value)}
              >
                <option value="">Select file…</option>
                {completeJobFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.file_name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => loadDropboxFiles(artworkOrigin)}>
                  Load working files
                </Button>
              </div>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={dropboxSourcePath}
                onChange={(event) => setDropboxSourcePath(event.target.value)}
              >
                <option value="">Select Dropbox file…</option>
                {dropboxFiles.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="proofTitle">Proof title</Label>
            <Input id="proofTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerMessage">Customer message</Label>
            <Textarea
              id="customerMessage"
              value={customerMessage}
              onChange={(e) => setCustomerMessage(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="internalNote">Internal note</Label>
            <Textarea
              id="internalNote"
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" disabled={pending} onClick={createProof}>
              Save draft proof
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {proofs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proofs yet.</p>
        ) : (
          proofs.map((proof) => (
            <div key={proof.id} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {proof.title} · v{proof.version_number}
                  </p>
                  <p className="text-xs text-muted-foreground">{proof.proof_reference}</p>
                </div>
                <StatusBadge
                  status={mapProofStatusToBadge(proof.status)}
                  label={PROOF_STATUS_LABELS[proof.status]}
                />
              </div>

              <div className="text-sm text-muted-foreground">
                <p>
                  Source: {PROOF_ARTWORK_ORIGIN_LABELS[proof.artwork_origin]} ·{" "}
                  {proof.files[0]?.file_name ?? "No file"}
                </p>
                {proof.sent_at ? (
                  <p>Sent: {new Date(proof.sent_at).toLocaleString("en-GB")}</p>
                ) : null}
                {proof.approved_at ? (
                  <p>Approved: {new Date(proof.approved_at).toLocaleString("en-GB")}</p>
                ) : null}
                {proof.changes_requested_comment ? (
                  <p>Customer comment: {proof.changes_requested_comment}</p>
                ) : null}
              </div>

              {proof.manifestItems.length ? (
                <ul className="text-sm">
                  {proof.manifestItems.map((item) => (
                    <li key={item.id}>
                      {item.item_reference ? `${item.item_reference} · ` : ""}
                      {item.item_name}
                    </li>
                  ))}
                </ul>
              ) : null}

              {proof.status === "draft" ? (
                <div className="space-y-3 border-t border-border pt-3">
                  <p className="text-sm font-medium">Internal checklist</p>
                  {PROOF_INTERNAL_CHECKLIST_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(checklist[`${proof.id}:${key}`])}
                        onChange={(event) =>
                          setChecklist((current) => ({
                            ...current,
                            [`${proof.id}:${key}`]: event.target.checked,
                          }))
                        }
                      />
                      {PROOF_INTERNAL_CHECKLIST_LABELS[key]}
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      proofAction(proof.id, "submit_internal_review", {
                        checklist: PROOF_INTERNAL_CHECKLIST_KEYS.reduce(
                          (acc, key) => ({
                            ...acc,
                            [key]: Boolean(checklist[`${proof.id}:${key}`]),
                          }),
                          {}
                        ),
                      })
                    }
                  >
                    Submit internal review
                  </Button>
                </div>
              ) : null}

              {proof.status === "internal_review" ? (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => proofAction(proof.id, "mark_ready_to_send")}
                >
                  Mark ready to send
                </Button>
              ) : null}

              {proof.status === "ready_to_send" ? (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => proofAction(proof.id, "send")}
                >
                  Send to customer
                </Button>
              ) : null}

              {["changes_requested", "superseded"].includes(proof.status) ? (
                <p className="text-xs text-muted-foreground">Archived version — read only.</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
