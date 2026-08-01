"use client";

import { ChevronDown } from "lucide-react";

import { CUSTOMER_QUOTE_TERMS_SECTIONS } from "@/lib/customer-quote-terms-content";

function TermsBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight text-neutral-950">
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-600">
        {children}
      </div>
    </section>
  );
}

function TermsSubheading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-sm font-medium text-neutral-900">{children}</h4>
  );
}

function renderParagraph(paragraph: string, index: number) {
  if (paragraph.startsWith("Invoice / Order Queries:")) {
    return (
      <p key={index}>
        <span className="font-medium text-neutral-800">
          Invoice / Order Queries:
        </span>{" "}
        Any queries regarding invoices, order details, or charges must be
        submitted in writing to{" "}
        <a
          href="mailto:accounts@candidcreative.uk"
          className="font-medium text-neutral-950 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-950"
        >
          accounts@candidcreative.uk
        </a>{" "}
        within 7 calendar days of the Tax invoice date.
      </p>
    );
  }

  return (
    <p key={index} className="whitespace-pre-wrap">
      {paragraph}
    </p>
  );
}

export function CustomerQuoteTermsSection() {
  return (
    <details className="group overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="text-lg font-semibold tracking-tight text-neutral-950">
          Terms &amp; Conditions
        </span>
        <ChevronDown
          aria-hidden
          className="h-5 w-5 shrink-0 text-neutral-400 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>

      <div className="space-y-8 border-t border-neutral-100 px-6 py-6">
        {CUSTOMER_QUOTE_TERMS_SECTIONS.map((section) => (
          <TermsBlock key={section.title} title={section.title}>
            {section.paragraphs?.map((paragraph, index) =>
              renderParagraph(paragraph, index)
            )}

            {section.subsections?.map((subsection) => (
              <div key={subsection.title} className="space-y-3">
                <TermsSubheading>{subsection.title}</TermsSubheading>
                {subsection.paragraphs.map((paragraph, index) => (
                  <p key={`${subsection.title}-${index}`}>{paragraph}</p>
                ))}
              </div>
            ))}
          </TermsBlock>
        ))}
      </div>
    </details>
  );
}
