"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type CreateQuoteButtonProps = {
  opportunityId: string;
  activeQuotes: {
    id: string;
    quote_number: number;
    project_name: string;
    status: string;
  }[];
};

export function CreateQuoteButton({
  opportunityId,
  activeQuotes,
}: CreateQuoteButtonProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);

  const primaryQuote = activeQuotes[0] ?? null;
  const href = `/admin/quotes/new?opportunityId=${encodeURIComponent(opportunityId)}`;

  if (primaryQuote && !showConfirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/quotes/${primaryQuote.id}`}>
          <Button variant="outline">
            View Q-{primaryQuote.quote_number}
          </Button>
        </Link>
        <Button variant="outline" onClick={() => setShowConfirm(true)}>
          Create additional quote
        </Button>
      </div>
    );
  }

  if (showConfirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Create another quote linked to this opportunity?
        </p>
        <Button onClick={() => router.push(href)}>Continue</Button>
        <Button variant="outline" onClick={() => setShowConfirm(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Link href={href}>
      <Button variant="outline">Create quote</Button>
    </Link>
  );
}
