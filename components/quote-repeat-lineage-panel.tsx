import Link from "next/link";

type QuoteRepeatLineagePanelProps = {
  repeatedFromQuoteId: string | null;
  repeatedFromQuoteNumber: number | null;
  repeatedFromVersionNumber: number | null;
  materialPricing: string | null;
  childRepeats: {
    id: string;
    quote_number: number;
    status: string;
  }[];
};

function formatPricingMode(mode: string | null) {
  if (mode === "refresh_catalogue") {
    return "Catalogue rates refreshed at repeat";
  }

  if (mode === "keep_saved") {
    return "Saved material costs kept at repeat";
  }

  return null;
}

export function QuoteRepeatLineagePanel({
  repeatedFromQuoteId,
  repeatedFromQuoteNumber,
  repeatedFromVersionNumber,
  materialPricing,
  childRepeats,
}: QuoteRepeatLineagePanelProps) {
  const pricingLabel = formatPricingMode(materialPricing);
  const showPanel =
    repeatedFromQuoteId != null || childRepeats.length > 0 || pricingLabel != null;

  if (!showPanel) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <p className="font-medium text-foreground">Repeat quote</p>

      {repeatedFromQuoteId && repeatedFromQuoteNumber != null ? (
        <p className="mt-2 text-muted-foreground">
          Repeated from{" "}
          <Link
            href={`/admin/quotes/${repeatedFromQuoteId}`}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Q-{repeatedFromQuoteNumber}
          </Link>
          {repeatedFromVersionNumber != null
            ? ` (version ${repeatedFromVersionNumber})`
            : null}
          .
          {pricingLabel ? ` ${pricingLabel}.` : null}
        </p>
      ) : null}

      {childRepeats.length > 0 ? (
        <div className="mt-3">
          <p className="text-muted-foreground">Repeat quotes created from this quote:</p>
          <ul className="mt-1 list-inside list-disc">
            {childRepeats.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/admin/quotes/${child.id}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Q-{child.quote_number}
                </Link>
                <span className="text-muted-foreground"> · {child.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
