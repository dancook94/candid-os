"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ADMIN_ARTWORK_SOURCE_LABELS,
  JOB_ARTWORK_SOURCES,
} from "@/lib/jobs/artwork-source";
import type { JobArtworkSource } from "@/lib/jobs/types";

type AdminJobArtworkSourcePanelProps = {
  jobId: string;
  artworkSource: JobArtworkSource;
};

export function AdminJobArtworkSourcePanel({
  jobId,
  artworkSource,
}: AdminJobArtworkSourcePanelProps) {
  const [selectedSource, setSelectedSource] = useState<JobArtworkSource>(artworkSource);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSource, setSavedSource] = useState(artworkSource);

  async function saveArtworkSource() {
    setError(null);
    setPending(true);

    const response = await fetch(`/api/admin/jobs/${jobId}/artwork-source`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artworkSource: selectedSource }),
    });

    const payload = (await response.json()) as { error?: string; artworkSource?: JobArtworkSource };

    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to update artwork source.");
      return;
    }

    if (payload.artworkSource) {
      setSavedSource(payload.artworkSource);
      setSelectedSource(payload.artworkSource);
    }

    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-neutral-950">Artwork source</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal workflow control. Customer uploads remain available unless the job is
          completed or cancelled.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="space-y-3">
        <Label htmlFor="artwork-source">Artwork source</Label>
        <select
          id="artwork-source"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selectedSource}
          onChange={(event) =>
            setSelectedSource(event.target.value as JobArtworkSource)
          }
          disabled={pending}
        >
          {JOB_ARTWORK_SOURCES.map((source) => (
            <option key={source} value={source}>
              {ADMIN_ARTWORK_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || selectedSource === savedSource}
          onClick={saveArtworkSource}
        >
          Save artwork source
        </Button>
        <p className="text-sm text-muted-foreground">
          Current: {ADMIN_ARTWORK_SOURCE_LABELS[savedSource]}
        </p>
      </div>
    </div>
  );
}
