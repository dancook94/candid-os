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
}: QuoteVersionSelectorProps) {
  const router = useRouter();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const versionNumber = event.target.value;
    router.push(`/admin/quotes/${quoteId}?version=${versionNumber}`);
  }

  return (
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
            v{version.version_number} · {formatStatusLabel(version.version_status)} ·{" "}
            {formatDate(version.created_at)}
          </option>
        ))}
      </select>
    </div>
  );
}
