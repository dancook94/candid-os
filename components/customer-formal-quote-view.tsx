import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FileText,
  Users,
} from "lucide-react";

import { CustomerQuoteActions } from "@/components/customer-quote-actions";
import { CustomerQuoteDownloadPdfButton } from "@/components/customer-quote-download-pdf-button";
import { CustomerQuoteTermsSection } from "@/components/customer-quote-terms-section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  formatQuoteProjectName,
  getFormalQuoteStatusLabel,
  mapCustomerQuoteStatusToBadge,
} from "@/lib/customer-quote-request";

const CANDID_YELLOW = "#fbd12c";

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
  quoteId: string;
  showPdfDownload: boolean;
  quoteNumber: number;
  projectName: string;
  quoteStatus: string;
  versionNumber: number;
  canRespondToQuote: boolean;
  dateSent: string | null;
  expiryDate: string | null;
  paymentTermsDays: number | null;
  approvedDeadline: string | null;
  deadlineDiagnostic?: string | null;
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

function SummaryCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-50 ring-1 ring-neutral-200/80">
          <Icon className="h-5 w-5 text-neutral-700" aria-hidden />
        </div>
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
          {title}
        </h2>
      </div>
      <div className="space-y-1.5 text-sm leading-relaxed text-neutral-600">
        {children}
      </div>
    </article>
  );
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex flex-col rounded-xl border border-neutral-200/80 bg-white px-4 py-2.5 shadow-sm">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
        {label}
      </span>
      <span className="mt-0.5 text-sm font-semibold text-neutral-950">
        {value}
      </span>
    </div>
  );
}

export function CustomerFormalQuoteView({
  quoteId,
  showPdfDownload,
  quoteNumber,
  projectName,
  quoteStatus,
  versionNumber,
  canRespondToQuote,
  dateSent,
  expiryDate,
  paymentTermsDays,
  approvedDeadline,
  deadlineDiagnostic,
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
  const showAcceptedConfirmation = quoteStatus === "accepted";
  const showDeclinedConfirmation = quoteStatus === "declined";

  return (
    <div className="min-h-screen bg-[#fafafa] pb-16 pt-6 sm:pb-20 sm:pt-8">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:max-w-6xl lg:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Link href={backHref}>
            <Button
              variant="ghost"
              className="gap-2 px-0 text-neutral-600 hover:bg-transparent hover:text-neutral-950"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to quotes
            </Button>
          </Link>

          {showPdfDownload ? (
            <CustomerQuoteDownloadPdfButton quoteId={quoteId} />
          ) : null}
        </div>

        <header className="mb-12 space-y-8 sm:mb-16">
          <Image
            src="/LOGO_YELLOW.svg"
            alt="Candid Creative"
            width={240}
            height={117}
            priority
            className="h-auto w-[min(240px,75vw)]"
          />

          <div className="space-y-5">
            <p className="text-4xl font-semibold tracking-tight text-neutral-950 sm:text-5xl">
              Quotation
            </p>

            <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-neutral-950 sm:text-5xl lg:text-6xl lg:leading-[1.05]">
              {displayProjectName}
            </h1>

            {customerCompanyName ? (
              <p className="text-lg text-neutral-500 sm:text-xl">
                Prepared for{" "}
                <span className="font-medium text-neutral-800">
                  {customerCompanyName}
                </span>
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <MetaBadge label="Version" value={String(versionNumber)} />
              <div className="inline-flex flex-col rounded-xl border border-neutral-200/80 bg-white px-4 py-2.5 shadow-sm">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
                  Status
                </span>
                <div className="mt-1">
                  <StatusBadge
                    status={mapCustomerQuoteStatusToBadge(quoteStatus)}
                    label={statusLabel}
                  />
                </div>
              </div>
              {expiryDate ? (
                <MetaBadge label="Expiry" value={formatDate(expiryDate)} />
              ) : null}
            </div>
          </div>

          {introduction ? (
            <p className="max-w-3xl text-base leading-relaxed text-neutral-600 sm:text-lg">
              {introduction}
            </p>
          ) : null}
        </header>

        {showAcceptedConfirmation ? (
          <div className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <p className="font-semibold">Quotation accepted</p>
            <p className="mt-1">
              You accepted Q-{quoteNumber}, Version {versionNumber}. Candid Creative
              has been notified.
            </p>
          </div>
        ) : null}

        {showDeclinedConfirmation ? (
          <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
            <p className="font-semibold">Quotation declined</p>
            <p className="mt-1">
              You declined Q-{quoteNumber}, Version {versionNumber}. Candid Creative
              has been notified.
            </p>
          </div>
        ) : null}

        <CustomerQuoteActions
          quoteId={quoteId}
          quoteNumber={quoteNumber}
          versionNumber={versionNumber}
          total={total}
          canRespond={canRespondToQuote}
        />

        <section
          aria-label="Quote summary"
          className="mb-12 grid gap-4 sm:mb-16 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5"
        >
          <SummaryCard icon={Building2} title="From">
            <p className="font-medium text-neutral-950">Candid Creative Limited</p>
            <p>Innovation House</p>
            <p>Cray Road, Sidcup</p>
            <p>DA14 5DP</p>
            <p>
              <a
                href="https://www.candidcreative.uk"
                className="font-medium text-neutral-950 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-950"
              >
                www.candidcreative.uk
              </a>
            </p>
            <p>020 3149 8995</p>
            <p className="pt-1 text-neutral-500">Company no. 15150018</p>
            <p className="text-neutral-500">VAT no. 451 8762 73</p>
          </SummaryCard>

          <SummaryCard icon={Users} title="Prepared for">
            {customerCompanyName ? (
              <p className="font-medium text-neutral-950">{customerCompanyName}</p>
            ) : null}
            {customerContactName ? <p>{customerContactName}</p> : null}
            {customerEmail ? (
              <p>
                <a
                  href={`mailto:${customerEmail}`}
                  className="font-medium text-neutral-950 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-950"
                >
                  {customerEmail}
                </a>
              </p>
            ) : null}
            {!customerCompanyName &&
              !customerContactName &&
              !customerEmail && <p className="text-neutral-400">—</p>}
          </SummaryCard>

          <SummaryCard icon={FileText} title="Quote details">
            <p>
              <span className="text-neutral-500">Quote number</span>
              <br />
              <span className="font-medium text-neutral-950">Q-{quoteNumber}</span>
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
            {paymentTermsDays !== null ? (
              <p>
                <span className="text-neutral-500">Payment terms</span>
                <br />
                <span className="font-medium text-neutral-950">
                  {paymentTermsDays} days
                </span>
              </p>
            ) : null}
            {expiryDate ? (
              <p className="flex items-start gap-2">
                <CalendarDays
                  className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400"
                  aria-hidden
                />
                <span>
                  <span className="text-neutral-500">Valid until</span>
                  <br />
                  <span className="font-medium text-neutral-950">
                    {formatDate(expiryDate)}
                  </span>
                </span>
              </p>
            ) : null}
            {approvedDeadline ? (
              <p>
                <span className="text-neutral-500">Approved deadline</span>
                <br />
                <span className="font-medium text-neutral-950">
                  {approvedDeadline}
                </span>
              </p>
            ) : null}
            {deadlineDiagnostic ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-semibold">Deadline debug:</span>{" "}
                {deadlineDiagnostic}
              </p>
            ) : null}
          </SummaryCard>
        </section>

        <section aria-label="Products" className="mb-12 space-y-5 sm:mb-16">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
              Products
            </h2>
            <p className="text-sm text-neutral-500">
              {lineItems.length} item{lineItems.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="space-y-4">
            {lineItems.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm sm:p-6"
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                  {item.imageUrl ? (
                    <div className="mx-auto flex h-[180px] w-[180px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-100 bg-neutral-50 shadow-md lg:mx-0">
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="h-full w-full object-contain p-2"
                      />
                    </div>
                  ) : null}

                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-2xl">
                          {item.title}
                        </h3>
                        {item.isOptional && (
                          <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">
                            Optional
                          </span>
                        )}
                      </div>

                      {item.description ? (
                        <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-neutral-600 sm:text-base">
                          {item.description}
                        </p>
                      ) : null}
                    </div>

                    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-100">
                        <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                          Quantity
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-neutral-950">
                          {item.quantity}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-100">
                        <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                          Unit price
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-neutral-950">
                          {formatGbp(item.unitPrice)}
                        </dd>
                      </div>
                      <div className="col-span-2 rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-100 sm:col-span-2">
                        <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                          Line total
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-neutral-950">
                          {formatGbp(item.lineTotal)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-label="Totals" className="mb-12 sm:mb-16">
          <article className="ml-auto max-w-md overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm">
            <div className="space-y-4 px-6 py-6">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-neutral-500">Subtotal</span>
                <span className="font-medium text-neutral-950">
                  {formatGbp(subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-neutral-500">VAT (20%)</span>
                <span className="font-medium text-neutral-950">
                  {formatGbp(vatAmount)}
                </span>
              </div>
            </div>

            <div
              className="px-6 py-6"
              style={{ backgroundColor: `${CANDID_YELLOW}22` }}
            >
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm font-medium uppercase tracking-[0.12em] text-neutral-700">
                  Total
                </span>
                <span
                  className="text-4xl font-bold tracking-tight sm:text-5xl"
                  style={{ color: "#1e1e1c" }}
                >
                  {formatGbp(total)}
                </span>
              </div>
            </div>
          </article>
        </section>

        {customerNotes ? (
          <section aria-label="Notes" className="mb-12 sm:mb-16">
            <article className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-2xl">
                Notes
              </h2>
              <p className="mt-4 max-w-3xl whitespace-pre-wrap text-base leading-relaxed text-neutral-600">
                {customerNotes}
              </p>
            </article>
          </section>
        ) : null}

        <section aria-label="Terms and conditions">
          <CustomerQuoteTermsSection />
        </section>
      </div>
    </div>
  );
}
