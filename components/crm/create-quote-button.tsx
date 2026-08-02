"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type CreateQuoteButtonProps = {
  opportunityId: string;
  hasContact: boolean;
  activeQuotes: {
    id: string;
    quote_number: number;
    project_name: string;
    status: string;
  }[];
};

export function CreateQuoteButton({
  opportunityId,
  hasContact,
  activeQuotes,
}: CreateQuoteButtonProps) {
  const router = useRouter();
  const href = `/admin/quotes/new?opportunityId=${encodeURIComponent(opportunityId)}`;

  if (!hasContact) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-amber-700">
          Add a contact to this opportunity before creating a quote.
        </p>
        <Button type="button" variant="outline" disabled>
          Create quote
        </Button>
      </div>
    );
  }

  const primaryQuote = activeQuotes[0] ?? null;

  if (primaryQuote) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/admin/quotes/${primaryQuote.id}`)}
        >
          View Q-{primaryQuote.quote_number}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(href)}>
          Create additional quote
        </Button>
      </div>
    );
  }

  return (
    <Button type="button" variant="outline" onClick={() => router.push(href)}>
      Create quote
    </Button>
  );
}
