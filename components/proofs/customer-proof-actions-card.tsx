import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CustomerProofActionItem } from "@/lib/proofs/customer-state";

type CustomerProofActionsCardProps = {
  awaitingApprovalCount: number;
  actions: CustomerProofActionItem[];
};

function formatSentDate(sentAt: string | null) {
  if (!sentAt) {
    return "Recently sent";
  }

  return new Date(sentAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CustomerProofActionsCard({
  awaitingApprovalCount,
  actions,
}: CustomerProofActionsCardProps) {
  if (awaitingApprovalCount === 0) {
    return null;
  }

  const preview = actions.slice(0, 5);

  return (
    <Card className="portal-surface mt-8 overflow-hidden border-sky-200 bg-sky-50/60">
      <CardHeader className="border-b border-sky-200/80">
        <CardTitle className="text-xl font-semibold text-sky-950">
          Proofs awaiting your approval
        </CardTitle>
        <CardDescription className="text-sky-900/80">
          {awaitingApprovalCount === 1
            ? "1 proof needs your review before production can continue."
            : `${awaitingApprovalCount} proofs need your review before production can continue.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-sky-200/70 p-0">
        {preview.map((action) => (
          <div
            key={action.proofId}
            className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium text-sky-950">
                {action.jobReference} · {action.projectName}
              </p>
              <p className="mt-1 text-sm text-sky-900/80">
                {action.proofTitle} · Proof v{action.version}
              </p>
              <p className="mt-1 text-xs text-sky-900/70">
                Sent {formatSentDate(action.sentAt)}
              </p>
            </div>
            <Link href={action.reviewUrl}>
              <Button>Review proof</Button>
            </Link>
          </div>
        ))}
        {actions.length > preview.length ? (
          <div className="px-6 py-4">
            <Link href="/jobs" className="text-sm font-medium text-sky-950 underline-offset-4 hover:underline">
              View all jobs
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
