"use client";

import { useRouter } from "next/navigation";

import { JobArtworkList } from "@/components/job-artwork-list";
import type { CustomerJobDetail } from "@/lib/jobs/types";

export function CustomerJobArtworkSection({ job }: { job: CustomerJobDetail }) {
  const router = useRouter();

  if (!job.artworkRequired) {
    return (
      <p className="text-sm text-muted-foreground">
        Artwork is not required for this job.
      </p>
    );
  }

  return (
    <JobArtworkList
      jobId={job.id}
      files={job.files}
      dropboxConfigured={job.dropboxConfigured}
      showArtworkRequired={job.needsArtworkUpload}
      onChanged={() => router.refresh()}
    />
  );
}
