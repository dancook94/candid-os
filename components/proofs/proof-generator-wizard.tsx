"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  PROOF_ARTWORK_ORIGIN_LABELS,
  PROOF_INTERNAL_CHECKLIST_KEYS,
  PROOF_INTERNAL_CHECKLIST_LABELS,
  type ProofArtworkOrigin,
} from "@/lib/proofs/constants";
import type { ProofSelectableManifestItem } from "@/lib/proofs/manifest-items";
import type {
  ArtworkSourceInput,
  PreflightCheck,
  PreflightResult,
} from "@/lib/proof-generator/types";

type DropboxFileOption = {
  id: string;
  name: string;
  path: string;
  size: number;
};

type ProofGeneratorWizardProps = {
  jobId: string;
  selectableItems: ProofSelectableManifestItem[];
  dropboxLinked: boolean;
  jobFiles: Array<{ id: string; file_name: string; upload_status: string }>;
  onClose: () => void;
  onComplete: () => void;
};

type WizardStep = "items" | "source" | "review";

function mapCheckStatusToBadge(status: PreflightCheck["status"]) {
  switch (status) {
    case "pass":
      return "approved" as const;
    case "warning":
      return "pending" as const;
    case "manual_review":
      return "declined" as const;
    default:
      return "draft" as const;
  }
}

function mapOverallStatusToBadge(status: PreflightResult["overallStatus"]) {
  switch (status) {
    case "pass":
      return "approved" as const;
    case "warning":
      return "pending" as const;
    default:
      return "declined" as const;
  }
}

export function ProofGeneratorWizard({
  jobId,
  selectableItems,
  dropboxLinked,
  jobFiles,
  onClose,
  onComplete,
}: ProofGeneratorWizardProps) {
  const [step, setStep] = useState<WizardStep>("items");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [artworkOrigin, setArtworkOrigin] = useState<ProofArtworkOrigin>("customer_uploaded");
  const [sourceKind, setSourceKind] = useState<
    "customer_artwork" | "working_file" | "proofs_folder" | "upload" | "job_file"
  >("customer_artwork");
  const [dropboxFiles, setDropboxFiles] = useState<DropboxFileOption[]>([]);
  const [selectedDropboxPath, setSelectedDropboxPath] = useState("");
  const [selectedJobFileId, setSelectedJobFileId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [warningsReviewed, setWarningsReviewed] = useState<Record<string, boolean>>({});
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [title, setTitle] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const completeJobFiles = jobFiles.filter((file) => file.upload_status === "complete");
  const warningChecks = preflight?.checks.filter(
    (check) => check.status === "warning" || check.status === "manual_review"
  ) ?? [];

  const selectedItems = useMemo(
    () => selectableItems.filter((item) => selectedItemIds.includes(item.id)),
    [selectableItems, selectedItemIds]
  );

  async function loadDropboxFiles(kind: typeof sourceKind) {
    if (!dropboxLinked) {
      setDropboxFiles([]);
      return;
    }

    setError(null);
    setPending(true);

    const listFolder =
      kind === "proofs_folder"
        ? { listFolder: "proofs_folder" as const }
        : {
            artworkOrigin:
              kind === "working_file"
                ? ("candid_created" as const)
                : ("customer_uploaded" as const),
          };

    const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(listFolder),
    });

    const payload = (await response.json()) as {
      files?: DropboxFileOption[];
      error?: string;
    };

    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to load Dropbox files.");
      return;
    }

    setDropboxFiles(payload.files ?? []);
  }

  function buildSourceInput(): ArtworkSourceInput | null {
    if (sourceKind === "upload") {
      if (!uploadFile) {
        return null;
      }

      return {
        type: "upload",
        fileName: uploadFile.name,
        mimeType: uploadFile.type || null,
      };
    }

    if (sourceKind === "job_file") {
      const file = completeJobFiles.find((item) => item.id === selectedJobFileId);
      if (!file) {
        return null;
      }

      return { type: "job_file", jobFileId: file.id };
    }

    const file = dropboxFiles.find((item) => item.path === selectedDropboxPath);
    if (!file) {
      return null;
    }

    return {
      type: "dropbox_path",
      dropboxPath: file.path,
      fileName: file.name,
    };
  }

  async function analyseArtwork() {
    setError(null);
    setPending(true);

    const source = buildSourceInput();
    if (!source) {
      setPending(false);
      setError("Select a source artwork file.");
      return;
    }

    if (source.type === "upload" && uploadFile) {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("productionItemIds", JSON.stringify(selectedItemIds));

      const response = await fetch(`/api/admin/jobs/${jobId}/proof-generator/analyse`, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        preflight?: PreflightResult;
        error?: string;
      };

      setPending(false);

      if (!response.ok) {
        setError(payload.error ?? "Unable to analyse artwork.");
        return;
      }

      setPreflight(payload.preflight ?? null);
      setStep("review");
      return;
    }

    const response = await fetch(`/api/admin/jobs/${jobId}/proof-generator/analyse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productionItemIds: selectedItemIds,
        source,
      }),
    });

    const payload = (await response.json()) as {
      preflight?: PreflightResult;
      error?: string;
    };

    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to analyse artwork.");
      return;
    }

    setPreflight(payload.preflight ?? null);
    if (!title.trim() && selectedItems[0]) {
      setTitle(selectedItems[0].itemName);
    }
    setStep("review");
  }

  async function generateProof() {
    setError(null);

    if (!preflight) {
      setError("Run artwork analysis before generating the proof.");
      return;
    }

    if (!title.trim()) {
      setError("Proof title is required.");
      return;
    }

    const unreviewedWarnings = warningChecks.filter(
      (check) => !warningsReviewed[check.key]
    );

    if (unreviewedWarnings.length > 0) {
      setError("Confirm each warning or manual review item before generating.");
      return;
    }

    setPending(true);
    const source = buildSourceInput();

    if (!source) {
      setPending(false);
      setError("Source artwork is no longer available.");
      return;
    }

    if (source.type === "upload" && uploadFile) {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("productionItemIds", JSON.stringify(selectedItemIds));
      formData.set("preflight", JSON.stringify(preflight));
      formData.set("title", title.trim());
      formData.set("customerMessage", customerMessage);
      formData.set("internalNote", internalNote);
      formData.set("artworkOrigin", artworkOrigin);

      const response = await fetch(`/api/admin/jobs/${jobId}/proof-generator/generate`, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as { error?: string };
      setPending(false);

      if (!response.ok) {
        setError(payload.error ?? "Unable to generate proof.");
        return;
      }

      onComplete();
      return;
    }

    const response = await fetch(`/api/admin/jobs/${jobId}/proof-generator/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productionItemIds: selectedItemIds,
        source,
        preflight,
        title: title.trim(),
        customerMessage: customerMessage.trim() || null,
        internalNote: internalNote.trim() || null,
        artworkOrigin,
        warningsReviewed,
        checklistAcknowledgements: checklist,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to generate proof.");
      return;
    }

    onComplete();
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Generate proof</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyse artwork, review automated checks, then generate a branded customer proof PDF.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {step === "items" ? (
        <div className="space-y-4">
          <div>
            <Label>Related production items</Label>
            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3">
              {selectableItems.map((item) => (
                <label key={item.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={(event) =>
                      setSelectedItemIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id)
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">
                      {item.itemReference ?? "Item"} · {item.itemName}
                    </span>
                    {item.finishedSize ? (
                      <span className="block text-muted-foreground">
                        Quoted size: {item.finishedSize}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button
            type="button"
            disabled={selectedItemIds.length === 0 || pending}
            onClick={() => setStep("source")}
          >
            Continue
          </Button>
        </div>
      ) : null}

      {step === "source" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="generatorOrigin">Artwork origin</Label>
            <select
              id="generatorOrigin"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={artworkOrigin}
              onChange={(event) =>
                setArtworkOrigin(event.target.value as ProofArtworkOrigin)
              }
            >
              {Object.entries(PROOF_ARTWORK_ORIGIN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sourceKind">Artwork source</Label>
            <select
              id="sourceKind"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={sourceKind}
              onChange={(event) => {
                const next = event.target.value as typeof sourceKind;
                setSourceKind(next);
                void loadDropboxFiles(next);
              }}
            >
              <option value="customer_artwork">Customer artwork (Dropbox)</option>
              <option value="working_file">Working/proof PDF (Dropbox)</option>
              <option value="proofs_folder">Existing file in 03 Proofs</option>
              <option value="job_file">Linked job artwork file</option>
              <option value="upload">Upload PDF or image</option>
            </select>
          </div>

          {sourceKind === "upload" ? (
            <div className="space-y-2">
              <Label htmlFor="generatorUpload">Upload artwork</Label>
              <Input
                id="generatorUpload"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
          ) : null}

          {sourceKind === "job_file" ? (
            <div className="space-y-2">
              <Label htmlFor="generatorJobFile">Job artwork file</Label>
              <select
                id="generatorJobFile"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={selectedJobFileId}
                onChange={(event) => setSelectedJobFileId(event.target.value)}
              >
                <option value="">Select file…</option>
                {completeJobFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.file_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {["customer_artwork", "working_file", "proofs_folder"].includes(sourceKind) ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="generatorDropboxFile">Dropbox file</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || !dropboxLinked}
                  onClick={() => void loadDropboxFiles(sourceKind)}
                >
                  Refresh files
                </Button>
              </div>
              <select
                id="generatorDropboxFile"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={selectedDropboxPath}
                onChange={(event) => setSelectedDropboxPath(event.target.value)}
              >
                <option value="">Select file…</option>
                {dropboxFiles.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("items")}>
              Back
            </Button>
            <Button type="button" disabled={pending} onClick={() => void analyseArtwork()}>
              Analyse artwork
            </Button>
          </div>
        </div>
      ) : null}

      {step === "review" && preflight ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Automated checks:</span>
            <StatusBadge
              status={mapOverallStatusToBadge(preflight.overallStatus)}
              label={
                preflight.overallStatus === "pass"
                  ? "Pass"
                  : preflight.overallStatus === "warning"
                    ? "Warnings"
                    : "Manual review required"
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Quoted specification</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {preflight.quotedItems.map((item) => (
                  <li key={item.id}>
                    {item.itemReference ?? "Item"} · {item.itemName}
                    {item.quotedWidthMm != null && item.quotedHeightMm != null
                      ? ` · ${item.quotedWidthMm} × ${item.quotedHeightMm} mm`
                      : ""}
                    {item.quantity != null ? ` · Qty ${item.quantity}` : ""}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Artwork specification</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                <li>File: {preflight.metadata.fileName}</li>
                <li>
                  Detected size:{" "}
                  {preflight.metadata.pageSize.value
                    ? `${preflight.metadata.pageSize.value.widthMm} × ${preflight.metadata.pageSize.value.heightMm} mm`
                    : "—"}
                </li>
                <li>Pages: {preflight.metadata.pageCount ?? "—"}</li>
                <li>Colour mode: {preflight.metadata.colourMode.value ?? "Unknown"}</li>
                {preflight.sizeComparison?.matchedScaleLabel ? (
                  <li>Scale: {preflight.sizeComparison.matchedScaleLabel}</li>
                ) : null}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Automated checks</p>
            <div className="space-y-2">
              {preflight.checks.map((check) => (
                <div
                  key={check.key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3 text-sm"
                >
                  <div>
                    <StatusBadge
                      status={mapCheckStatusToBadge(check.status)}
                      label={check.label}
                    />
                    <p className="mt-2 text-muted-foreground">{check.message}</p>
                  </div>
                  {check.status === "warning" || check.status === "manual_review" ? (
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(warningsReviewed[check.key])}
                        onChange={(event) =>
                          setWarningsReviewed((current) => ({
                            ...current,
                            [check.key]: event.target.checked,
                          }))
                        }
                      />
                      Reviewed
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Candid checklist</p>
            <div className="grid gap-2 md:grid-cols-2">
              {PROOF_INTERNAL_CHECKLIST_KEYS.map((key) => (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(checklist[key])}
                    onChange={(event) =>
                      setChecklist((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{PROOF_INTERNAL_CHECKLIST_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="generatorTitle">Proof title</Label>
              <Input
                id="generatorTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="generatorCustomerMessage">Customer message</Label>
              <Textarea
                id="generatorCustomerMessage"
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="generatorInternalNote">Internal note</Label>
              <Textarea
                id="generatorInternalNote"
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("source")}>
              Back
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void analyseArtwork()}>
              Regenerate analysis
            </Button>
            <Button type="button" disabled={pending} onClick={() => void generateProof()}>
              Generate customer proof
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
