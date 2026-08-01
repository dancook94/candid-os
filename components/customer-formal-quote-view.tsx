import Image from "next/image";
import Link from "next/link";

import { CustomerQuoteTermsSection } from "@/components/customer-quote-terms-section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  formatQuoteProjectName,
  getFormalQuoteStatusLabel,
  mapCustomerQuoteStatusToBadge,
} from "@/lib/customer-quote-request";

export type CustomerFormalQuoteLineItem = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  imageUrl: string | null;
  imageFileName: string | null;
};

export type CustomerFormalQuoteViewProps = {
  quoteNumber: number;
  projectName: string;
  quoteStatus: string;
  versionNumber: number;
  dateSent: string | null;
  expiryDate: string | null;
  paymentTermsDays: number | null;
  introduction: string | null;
  customerNotes: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  lineItems: CustomerFormalQuoteLineItem[];
  linkedRequestId: string | null;
  customerCompanyName: string | null;
  customerContactName: string | null;
  customerEmail: string | null;
};

function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function InfoColumn({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 space-y-3 ${className}`}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
        {title}
      </h2>
      <div className="space-y-1 text-sm leading-relaxed text-neutral-700">
        {children}
      </div>
    </section>
  );
}

export function CustomerFormalQuoteView({
  quoteNumber,
  projectName,
  quoteStatus,
  versionNumber,
  dateSent,
  expiryDate,
  paymentTermsDays,
  introduction,
  customerNotes,
  subtotal,
  vatAmount,
  total,
  lineItems,
  linkedRequestId,
  customerCompanyName,
  customerContactName,
  customerEmail,
}: CustomerFormalQuoteViewProps) {
  const backHref = linkedRequestId ? `/quotes/${linkedRequestId}` : "/quotes";
  const displayProjectName = formatQuoteProjectName(projectName);
  const statusLabel = getFormalQuoteStatusLabel(quoteStatus);

  return (
    <div className="mx-auto w-full max-w-[1150px] px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-4 flex justify-end">
        <Link href={backHref}>
          <Button variant="outline">Back to quotes</Button>
        </Link>
      </div>

      <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <header className="border-b border-neutral-200 px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="space-y-3">
                <Image
                  src="/LOGO_YELLOW.svg"
                  alt="Candid Creative"
                  width={180}
                  height={88}
                  priority
                  className="h-auto w-[min(180px,70vw)]"
                />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  Quotation
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 lg:items-end">
              <StatusBadge
                status={mapCustomerQuoteStatusToBadge(quoteStatus)}
                label={statusLabel}
              />
            </div>
          </div>
        </header>

        <div className="border-b border-neutral-200 px-6 py-8 sm:px-8">
          <div className="grid gap-8 md:grid-cols-3 md:gap-10">
            <InfoColumn
              title="From"
              className="md:border-r md:border-neutral-200 md:pr-10"
            >
              <p className="font-medium text-neutral-950">Candid Creative Limited</p>
              <p>Innovation House</p>
              <p>Cray Road</p>
              <p>Sidcup</p>
              <p>DA14 5DP</p>
              <p>
                <a
                  href="https://www.candidcreative.uk"
                  className="text-neutral-950 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-950"
                >
                  www.candidcreative.uk
                </a>
              </p>
              <p>020 3149 8995</p>
              <p>Company number: 15150018</p>
              <p>VAT number: 451 8762 73</p>
            </InfoColumn>

            <InfoColumn
              title="Prepared for"
              className="md:border-r md:border-neutral-200 md:pr-10"
            >
              {customerCompanyName ? (
                <p className="font-medium text-neutral-950">{customerCompanyName}</p>
              ) : null}
              {customerContactName ? <p>{customerContactName}</p> : null}
              {customerEmail ? (
                <p>
                  <a
                    href={`mailto:${customerEmail}`}
                    className="text-neutral-950 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-950"
                  >
                    {customerEmail}
                  </a>
                </p>
              ) : null}
              {!customerCompanyName &&
                !customerContactName &&
                !customerEmail && <p className="text-neutral-500">—</p>}
            </InfoColumn>

            <InfoColumn title="Quote details">
              <p>
                <span className="text-neutral-500">Quote number</span>
                <br />
                <span className="font-medium text-neutral-950">
                  Q-{quoteNumber}
                </span>
              </p>
              <p>
                <span className="text-neutral-500">Version</span>
                <br />
                <span className="font-medium text-neutral-950">
                  {versionNumber}
                </span>
              </p>
              {dateSent ? (
                <p>
                  <span className="text-neutral-500">Date sent</span>
                  <br />
                  <span className="font-medium text-neutral-950">
                    {formatDate(dateSent)}
                  </span>
                </p>
              ) : null}
              {expiryDate ? (
                <p>
                  <span className="text-neutral-500">Expiry date</span>
                  <br />
                  <span className="font-medium text-neutral-950">
                    {formatDate(expiryDate)}
                  </span>
                </p>
              ) : null}
              {paymentTermsDays !== null ? (
                <p>
                  <span className="text-neutral-500">Payment terms</span>
                  <br />
                  <span className="font-medium text-neutral-950">
                    {paymentTermsDays} days
                  </span>
                </p>
              ) : null}
            </InfoColumn>
          </div>
        </div>

        <div className="border-b border-neutral-200 px-6 py-8 sm:px-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
            {displayProjectName}
          </h1>
          {introduction ? (
            <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-neutral-600 sm:text-base">
              {introduction}
            </p>
          ) : null}
        </div>

        <div className="px-6 py-8 sm:px-8">
          <h2 className="mb-6 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Quote items
          </h2>

          <div className="divide-y divide-neutral-100 border-y border-neutral-100">
            {lineItems.map((item) => (
              <article key={item.id} className="py-6 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
                  {item.imageUrl ? (
                    <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 lg:h-[180px] lg:w-[180px]">
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-medium text-neutral-950">
                        {item.title}
                      </h3>
                      {item.isOptional && (
                        <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">
                          Optional
                        </span>
                      )}
                    </div>

                    {item.description ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">
                        {item.description}
                      </p>
                    ) : null}

                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:max-w-xl">
                      <div>
                        <dt className="text-neutral-500">Quantity</dt>
                        <dd className="mt-0.5 font-medium text-neutral-950">
                          {item.quantity}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Unit price ex VAT</dt>
                        <dd className="mt-0.5 font-medium text-neutral-950">
                          {formatGbp(item.unitPrice)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Line total</dt>
                        <dd className="mt-0.5 font-medium text-neutral-950">
                          {formatGbp(item.lineTotal)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {customerNotes ? (
            <section className="mt-10 border-t border-neutral-100 pt-8">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                Notes
              </h2>
              <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 sm:text-base">
                {customerNotes}
              </p>
            </section>
          ) : null}

          <div className="mt-10 flex justify-end">
            <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-neutral-50/80 p-5 shadow-sm">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-600">Subtotal</dt>
                  <dd className="font-medium text-neutral-950">
                    {formatGbp(subtotal)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-600">VAT 20%</dt>
                  <dd className="font-medium text-neutral-950">
                    {formatGbp(vatAmount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-neutral-200 pt-4">
                  <dt className="text-base font-medium text-neutral-950">
                    Total GBP
                  </dt>
                  <dd className="text-2xl font-semibold tracking-tight text-neutral-950">
                    {formatGbp(total)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <footer className="border-t border-neutral-200 bg-neutral-50/40 px-6 py-6 sm:px-8">
          <CustomerQuoteTermsSection />
        </footer>
      </article>
    </div>
  );
}
