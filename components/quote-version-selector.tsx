"use client";

import { useRouter } from "next/navigation";

import { Label } from "@/components/ui/label";

export type QuoteVersionOption = {
  version_number: number;
  version_status: string;
  created_at: string;
};

type QuoteVersionSelectorProps = {
  quoteId: string;
  versions: QuoteVersionOption[];
  selectedVersion: number;
  selectedVersionStatus: string;
  currentVersion: number;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function QuoteVersionSelector({
  quoteId,
  versions,
  selectedVersion,
  selectedVersionStatus,
  currentVersion,
}: QuoteVersionSelectorProps) {
  const router = useRouter();
  const isDraft = selectedVersionStatus === "draft";

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const versionNumber = event.target.value;
    router.push(`/admin/quotes/${quoteId}?version=${versionNumber}`);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="quote-version-selector">Version history</Label>
        <select
          id="quote-version-selector"
          value={selectedVersion}
          onChange={handleChange}
          className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10"
        >
          {versions.map((version) => (
            <option key={version.version_number} value={version.version_number}>
              v{version.version_number}
              {version.version_number === currentVersion ? " (current)" : ""} ·{" "}
              {formatStatusLabel(version.version_status)} ·{" "}
              {formatDate(version.created_at)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-neutral-950">
          Selected:{" "}
          <span className="font-medium">
            v{selectedVersion}
            {selectedVersion === currentVersion ? " (current)" : ""}
          </span>
        </p>
        {isDraft ? (
          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
            Editable draft
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-500/20">
            Read only
          </span>
        )}
      </div>
    </div>
  );
}
