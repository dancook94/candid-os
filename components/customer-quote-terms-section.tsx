"use client";

import { ChevronDown } from "lucide-react";

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
        <TermsBlock title="Invoice / Order Queries">
          <p>
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
          <p>
            This includes, but is not limited to, the quality of the finished
            goods, pricing of the project, or any associated services such as
            installation or post-event removal (if applicable).
          </p>
          <p>
            Outside of this 7-day period, the commercial figures stated on the
            invoice will be deemed accepted by both parties, with no room for
            challenge or dispute at a later date.
          </p>
          <p>We will do our best to resolve any queries promptly.</p>
          <p>
            Any disputes not raised within this period may not be considered.
          </p>
          <p>
            Failure to raise queries within 7 days of the Invoice will be taken
            as acceptance of the invoice and its details.
          </p>
        </TermsBlock>

        <TermsBlock title="Damage Liability">
          <p>
            By accepting our quotation, the client acknowledges and agrees that
            Candid Creative shall not be held liable for any damage to underlying
            materials, surfaces, fixtures, or structures resulting from the
            installation or removal of event-related items.
          </p>
          <p>
            This includes, but is not limited to, any penetrative or cosmetic
            damage (such as the loss of paint, scuffs, holes, or marks) caused
            by vinyl application, adhesives, nails, tape, or other fixings.
          </p>
          <p>
            While we exercise all reasonable care, we cannot guarantee zero
            damage due to the inherent variability of materials and substrates.
          </p>
          <p>
            This limitation of liability applies whether the installation or
            derig is carried out by Candid Creative or the client themselves.
          </p>
        </TermsBlock>

        <TermsBlock title="Artworking Proofing and Approval">
          <TermsSubheading>Artwork Creation &amp; Approval</TermsSubheading>
          <p>
            Once you provide the necessary design brief, digital assets and
            logos, our team will create the requested artwork according to your
            specifications.
          </p>
          <p>
            You will receive a digital proof for review before production.
          </p>
          <p>
            It is your responsibility to check all artwork including layout,
            colours, spelling, dimensions and logo placement.
          </p>
          <p>Written approval authorises production.</p>

          <TermsSubheading>Hourly Charges</TermsSubheading>
          <p>Artwork is charged at:</p>
          <p>£50 + VAT per hour</p>
          <p>rounded to the nearest 15 minutes.</p>
          <p>Outside working hours:</p>
          <p>£60 + VAT per hour.</p>

          <TermsSubheading>Additional Edits</TermsSubheading>
          <p>
            Changes after approval may incur artwork, production and material
            costs.
          </p>

          <TermsSubheading>Client Responsibility</TermsSubheading>
          <p>
            Clients remain responsible for checking artwork before approval.
          </p>

          <TermsSubheading>Artwork Invoicing</TermsSubheading>
          <p>Artwork is invoiced separately from production.</p>
        </TermsBlock>
      </div>
    </details>
  );
}
