"use client";

type QuoteTermsSection = {
  id: string;
  title: string;
  paragraphs: string[];
};

const quoteTermsSections: QuoteTermsSection[] = [
  {
    id: "payment-methods",
    title: "Payment Methods",
    paragraphs: [],
  },
  {
    id: "invoice-queries",
    title: "Invoice / Order Queries",
    paragraphs: [],
  },
  {
    id: "damage-liability",
    title: "Damage Liability",
    paragraphs: [],
  },
  {
    id: "artwork-proofing",
    title: "Artwork Proofing and Approval",
    paragraphs: [],
  },
];

export function CustomerQuoteTermsSection() {
  const hasTermsContent = quoteTermsSections.some(
    (section) => section.paragraphs.length > 0
  );

  return (
    <details className="group rounded-xl border border-neutral-200 bg-neutral-50/60">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-neutral-700 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          View terms and conditions
          <span
            aria-hidden
            className="text-neutral-400 transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </span>
      </summary>

      <div className="space-y-5 border-t border-neutral-200 px-5 py-5 text-sm text-neutral-600">
        {quoteTermsSections.map((section) => (
          <section key={section.id} aria-labelledby={`${section.id}-heading`}>
            <h3
              id={`${section.id}-heading`}
              className="font-medium text-neutral-950"
            >
              {section.title}
            </h3>
            {section.paragraphs.length > 0 ? (
              <div className="mt-2 space-y-2">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="whitespace-pre-wrap">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        ))}

        {!hasTermsContent && (
          <p className="text-neutral-500">
            Full terms and conditions are provided with your official Candid
            Creative quotation documentation. Contact us if you need a copy.
          </p>
        )}
      </div>
    </details>
  );
}
