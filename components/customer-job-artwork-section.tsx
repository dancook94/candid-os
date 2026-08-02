"use client";

import { useRouter } from "next/navigation";

import { JobArtworkList } from "@/components/job-artwork-list";
import type { CustomerJobDetail } from "@/lib/jobs/types";

export function CustomerJobArtworkSection({ job }: { job: CustomerJobDetail }) {
  const router = useRouter();

  return (
    <JobArtworkList
      jobId={job.id}
      files={job.files}
      dropboxConfigured={job.dropboxConfigured}
      onChanged={() => router.refresh()}
    />
  );
}
