"use client";

import { useState } from "react";

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
import type { ProofSelectableManifestItem } from "@/lib/proofs/manifest-items";
import {
  getSourceArtworkFile,
  hasGeneratedCustomerProof,
} from "@/lib/proofs/proof-files";
import { ProofBrandedPdfPanel } from "@/components/proofs/proof-branded-pdf-panel";
import { ProofFileAttachmentPanel } from "@/components/proofs/proof-file-attachment-panel";

type AdminJobProofsPanelProps = {
  jobId: string;
  selectableItems: ProofSelectableManifestItem[];
  manifestSchemaMissing?: boolean;
  dropboxLinked: boolean;
  jobFiles: Array<{ id: string; file_name: string; upload_status: string }>;
  initialRequirement: {
    proofRequired: boolean;
    workflowStatus: string;
    bypassReason: string | null;
    bypassedAt: string | null;
    bypassedByName: string | null;
  };
  initialProofs: JobProofView[];
  schemaMissing?: boolean;
};

function requiresGeneratedCustomerProof(proof: JobProofView) {
  return Boolean(getSourceArtworkFile(proof.files));
}

function canSendBrandedProof(proof: JobProofView) {
  if (!requiresGeneratedCustomerProof(proof)) {
    return true;
  }

  return hasGeneratedCustomerProof(proof.files);
}

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
  selectableItems,
  manifestSchemaMissing,
  dropboxLinked,
  jobFiles,
  initialRequirement,
  initialProofs,
  schemaMissing,
}: AdminJobProofsPanelProps) {
  const [proofRequired, setProofRequired] = useState(initialRequirement.proofRequired);
  const [workflowStatus, setWorkflowStatus] = useState(initialRequirement.workflowStatus);
  const [bypassReasonText, setBypassReasonText] = useState(initialRequirement.bypassReason);
  const [bypassedAt, setBypassedAt] = useState(initialRequirement.bypassedAt);
  const [bypassedByName, setBypassedByName] = useState(initialRequirement.bypassedByName);
  const [proofs, setProofs] = useState(initialProofs);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [attachPromptProofId, setAttachPromptProofId] = useState<string | null>(null);
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

  const completeJobFiles = jobFiles.filter((file) => file.upload_status === "complete");

  const canSaveDraft =
    title.trim().length > 0 && selectedItemIds.length > 0 && !pending;

  const createArtworkOrigins: ProofArtworkOrigin[] = [
    "customer_uploaded",
    "candid_created",
  ];

  async function refreshProofs() {
    const response = await fetch(`/api/admin/jobs/${jobId}/proof-requirement`);
    const payload = (await response.json()) as {
      requirement?: {
        proofRequired: boolean;
        workflowStatus: string;
        bypassReason?: string | null;
        bypassedAt?: string | null;
        bypassedByName?: string | null;
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
      setBypassReasonText(payload.requirement.bypassReason ?? null);
      setBypassedAt(payload.requirement.bypassedAt ?? null);
      setBypassedByName(payload.requirement.bypassedByName ?? null);
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
    if (!dropboxLinked) {
      setDropboxFiles([]);
      return;
    }

    setError(null);
    const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artworkOrigin: origin }),
    });

    const payload = (await response.json()) as {
      files?: Array<{ id: string; name: string; path: string; size: number }>;
      dropboxLinked?: boolean;
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Unable to load Dropbox files.");
      return;
    }

    setDropboxFiles(payload.files ?? []);
  }

  async function createProof() {
    if (!canSaveDraft) {
      setError("Enter a proof title and select at least one quoted item.");
      return;
    }

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

  async function refreshAfterProofAction() {
    await refreshProofs();
    window.location.reload();
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

    await refreshAfterProofAction();
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
            <div className="mt-2">
              <StatusBadge
                status={proofRequired ? "pending" : "disabled"}
                label={proofRequired ? "Required" : "Not required"}
              />
            </div>
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

        {!proofRequired ? (
          <div className="mt-4 space-y-1 rounded-md border border-border bg-background/80 p-3 text-sm">
            <p className="font-medium text-foreground">Proof bypass</p>
            {bypassReasonText ? (
              <p className="text-muted-foreground">Reason: {bypassReasonText}</p>
            ) : (
              <p className="text-muted-foreground">Reason not recorded.</p>
            )}
            {bypassedByName || bypassedAt ? (
              <p className="text-muted-foreground">
                {bypassedByName ? `By ${bypassedByName}` : "By staff"}
                {bypassedAt
                  ? ` on ${new Date(bypassedAt).toLocaleString("en-GB")}`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {proofRequired ? (
            <>
              <div className="w-full space-y-2">
                <Label htmlFor="bypassReason">Reason for not requiring proof</Label>
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
                Mark not required
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
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {showCreate ? (
        <div className="rounded-lg border border-border p-4 space-y-5">
          <div>
            <h3 className="font-semibold">Create proof</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Saves an internal draft only. Nothing is sent to the customer yet.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Quoted / production items</Label>
            <p className="text-sm text-muted-foreground">
              Select every manifest line this proof covers. One proof can span multiple items.
            </p>

            {manifestSchemaMissing ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Production manifest schema is not available. Apply the production manifest
                migration before linking proofs to quoted items.
              </p>
            ) : selectableItems.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                No production manifest items were found for this job. Items are created from
                the accepted quote in the production manifest. Check the manifest section
                above or ensure this job has an accepted quote version.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {selectableItems.map((item) => {
                  const selected = selectedItemIds.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
                        selected
                          ? "border-[var(--candid-yellow)] bg-[var(--candid-yellow)]/10"
                          : "border-border hover:border-muted-foreground/40"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected}
                          onChange={(event) => {
                            setSelectedItemIds((current) =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id)
                            );
                          }}
                        />
                        <div className="min-w-0 space-y-1 text-sm">
                          <p className="font-medium text-neutral-950">
                            {item.itemReference ? `${item.itemReference} · ` : ""}
                            {item.itemName}
                          </p>
                          {item.description ? (
                            <p className="text-muted-foreground">{item.description}</p>
                          ) : null}
                          <dl className="grid gap-1 text-muted-foreground">
                            {item.quantity != null ? (
                              <div>
                                <span className="font-medium text-neutral-700">Quantity: </span>
                                {item.quantity}
                              </div>
                            ) : null}
                            {item.finishedSize ? (
                              <div>
                                <span className="font-medium text-neutral-700">Size: </span>
                                {item.finishedSize}
                              </div>
                            ) : null}
                            {item.materialSpec ? (
                              <div>
                                <span className="font-medium text-neutral-700">
                                  Material/spec:{" "}
                                </span>
                                {item.materialSpec}
                              </div>
                            ) : null}
                          </dl>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <Label htmlFor="artworkOrigin">Artwork source (optional for draft)</Label>
            <p className="text-sm text-muted-foreground">
              Artwork can be connected later. When a Dropbox folder exists, files will load
              from the relevant job folder.
            </p>

            {!dropboxLinked ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                No Dropbox folder is linked to this job yet.
              </p>
            ) : null}

            <select
              id="artworkOrigin"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={artworkOrigin}
              onChange={async (event) => {
                const origin = event.target.value as ProofArtworkOrigin;
                setArtworkOrigin(origin);
                setDropboxSourcePath("");
                setSourceJobFileId("");
                if (dropboxLinked && origin === "candid_created") {
                  await loadDropboxFiles(origin);
                }
              }}
            >
              {createArtworkOrigins.map((value) => (
                <option key={value} value={value}>
                  {PROOF_ARTWORK_ORIGIN_LABELS[value]}
                </option>
              ))}
            </select>

            {artworkOrigin === "customer_uploaded" ? (
              <div className="space-y-2">
                <Label htmlFor="sourceJobFileId">Customer artwork file (optional)</Label>
                {completeJobFiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No completed customer artwork uploads on this job yet.
                  </p>
                ) : (
                  <select
                    id="sourceJobFileId"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={sourceJobFileId}
                    onChange={(event) => setSourceJobFileId(event.target.value)}
                  >
                    <option value="">Connect artwork later</option>
                    {completeJobFiles.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.file_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Candid working file (optional)</Label>
                {!dropboxLinked ? (
                  <p className="text-sm text-muted-foreground">
                    Link a Dropbox folder to this job before selecting working files.
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => loadDropboxFiles(artworkOrigin)}
                      >
                        Load working files
                      </Button>
                    </div>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={dropboxSourcePath}
                      onChange={(event) => setDropboxSourcePath(event.target.value)}
                    >
                      <option value="">Connect artwork later</option>
                      {dropboxFiles.map((file) => (
                        <option key={file.path} value={file.path}>
                          {file.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4 border-t border-border pt-4">
            <div className="space-y-2">
              <Label htmlFor="proofTitle">Proof title</Label>
              <Input
                id="proofTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Lobby panels proof"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerMessage">Customer message</Label>
              <Textarea
                id="customerMessage"
                value={customerMessage}
                onChange={(e) => setCustomerMessage(e.target.value)}
                rows={3}
                placeholder="Message shown to the customer when the proof is sent."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="internalNote">Internal note</Label>
              <p className="text-xs text-muted-foreground">
                Internal only — never visible to customer
              </p>
              <Textarea
                id="internalNote"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" disabled={!canSaveDraft} onClick={createProof}>
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
                <p>Source: {PROOF_ARTWORK_ORIGIN_LABELS[proof.artwork_origin]}</p>
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

              <ProofFileAttachmentPanel
                jobId={jobId}
                proof={proof}
                dropboxLinked={dropboxLinked}
                jobFiles={jobFiles}
                pending={pending}
                onPendingChange={setPending}
                onError={setError}
                onRefresh={refreshProofs}
                forceShowAttach={attachPromptProofId === proof.id}
                onAttachFormOpened={() => setAttachPromptProofId(null)}
              />

              <ProofBrandedPdfPanel
                jobId={jobId}
                proof={proof}
                pending={pending}
                onPendingChange={setPending}
                onError={setError}
                onRefresh={refreshProofs}
                onRequestAttach={() => setAttachPromptProofId(proof.id)}
              />

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
                  disabled={pending || !canSendBrandedProof(proof)}
                  onClick={() => proofAction(proof.id, "mark_ready_to_send")}
                >
                  Mark ready to send
                </Button>
              ) : null}

              {proof.status === "ready_to_send" ? (
                <Button
                  type="button"
                  disabled={pending || !canSendBrandedProof(proof)}
                  onClick={() => proofAction(proof.id, "send")}
                >
                  Send to customer
                </Button>
              ) : null}

              {requiresGeneratedCustomerProof(proof) && !canSendBrandedProof(proof) ? (
                <p className="text-xs text-amber-800">
                  Generate the branded customer proof PDF before marking ready or sending.
                </p>
              ) : null}

              {["sent", "viewed"].includes(proof.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => proofAction(proof.id, "resend_notification")}
                >
                  Resend proof notification
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
