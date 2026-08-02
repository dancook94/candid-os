import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import type { CustomerJobRecord } from "@/lib/customer-jobs";

type CustomerJobsListProps = {
  jobs: CustomerJobRecord[];
};

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

function mapJobStatusToBadge(status: string): BadgeStatus {
  switch (status) {
    case "awaiting_artwork":
      return "pending";
    case "artwork_uploaded":
      return "sent";
    case "in_production":
      return "sent";
    case "ready":
      return "approved";
    case "completed":
      return "accepted";
    case "active":
      return "draft";
    default:
      return "draft";
  }
}

function formatDate(dateString: string | null) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatFulfilmentMethod(value: string | null) {
  if (!value) {
    return "—";
  }

  return value === "collection" ? "Collection" : "Delivery";
}

export function CustomerJobsList({ jobs }: CustomerJobsListProps) {
  return (
    <div className="overflow-x-auto">
      <table className="portal-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Project</th>
            <th>Status</th>
            <th>Required date</th>
            <th>Fulfilment</th>
            <th>Related quote</th>
            <th>Artwork</th>
            <th>Last updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="hover:bg-muted/35">
              <td className="p-4 font-medium text-foreground">
                <Link
                  href={`/jobs/${job.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {job.reference}
                </Link>
              </td>
              <td className="p-4 text-muted-foreground">
                <Link href={`/jobs/${job.id}`} className="block">
                  {job.projectTitle}
                </Link>
              </td>
              <td className="p-4">
                <StatusBadge
                  status={mapJobStatusToBadge(job.status)}
                  label={job.statusLabel}
                />
              </td>
              <td className="p-4 text-muted-foreground">
                {formatDate(job.requiredDate)}
              </td>
              <td className="p-4 text-muted-foreground">
                {formatFulfilmentMethod(job.fulfilmentMethod)}
              </td>
              <td className="p-4 text-muted-foreground">
                {job.quoteId && job.quoteNumber ? (
                  <Link
                    href={`/quotes/${job.quoteId}`}
                    className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
                  >
                    {job.quoteNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="p-4">
                {job.artworkRequired ? (
                  job.needsArtworkUpload ? (
                    <StatusBadge status="pending" label="Artwork required" />
                  ) : (
                    <span className="text-sm text-muted-foreground">Provided</span>
                  )
                ) : (
                  <span className="text-sm text-muted-foreground">Not required</span>
                )}
              </td>
              <td className="p-4 text-muted-foreground">
                {formatDate(job.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
