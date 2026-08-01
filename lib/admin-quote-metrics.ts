import type { SupabaseClient } from "@supabase/supabase-js";

import { formatGbp, formatQuoteCount } from "@/lib/format-currency";

type QuoteRow = {
  id: string;
  current_version: number;
  status: string;
};

type VersionRow = {
  quote_id: string;
  version_number: number;
  version_status: string;
  total: number | string | null;
};

export type AdminQuoteValueMetric = {
  totalValue: number;
  quoteCount: number;
  formattedValue: string;
  formattedQuoteCount: string;
};

export type AdminQuoteMetrics = {
  quotesSent: AdminQuoteValueMetric;
  quotesAccepted: AdminQuoteValueMetric;
  errors: string[];
};

function emptyMetric(): AdminQuoteValueMetric {
  return {
    totalValue: 0,
    quoteCount: 0,
    formattedValue: formatGbp(0),
    formattedQuoteCount: formatQuoteCount(0),
  };
}

function buildMetric(rows: { total: number }[]): AdminQuoteValueMetric {
  const totalValue = rows.reduce((sum, row) => sum + row.total, 0);

  return {
    totalValue,
    quoteCount: rows.length,
    formattedValue: formatGbp(totalValue),
    formattedQuoteCount: formatQuoteCount(rows.length),
  };
}

function matchCurrentVersion(
  quote: QuoteRow,
  version: VersionRow,
  expectedQuoteStatus: string,
  expectedVersionStatus: string
) {
  return (
    quote.status === expectedQuoteStatus &&
    version.version_number === quote.current_version &&
    version.version_status === expectedVersionStatus
  );
}

export async function fetchAdminQuoteMetrics(
  supabase: SupabaseClient
): Promise<AdminQuoteMetrics> {
  const errors: string[] = [];

  const [{ data: sentQuotes, error: sentQuotesError }, { data: acceptedQuotes, error: acceptedQuotesError }] =
    await Promise.all([
      supabase
        .from("quotes")
        .select("id, current_version, status")
        .eq("status", "sent"),
      supabase
        .from("quotes")
        .select("id, current_version, status")
        .eq("status", "accepted"),
    ]);

  if (sentQuotesError) {
    errors.push(`Quotes sent: ${sentQuotesError.message}`);
  }

  if (acceptedQuotesError) {
    errors.push(`Quotes accepted: ${acceptedQuotesError.message}`);
  }

  const relevantQuotes = [...(sentQuotes ?? []), ...(acceptedQuotes ?? [])];

  if (relevantQuotes.length === 0) {
    return {
      quotesSent: emptyMetric(),
      quotesAccepted: emptyMetric(),
      errors,
    };
  }

  const quoteIds = relevantQuotes.map((quote) => quote.id);
  const quoteById = new Map(relevantQuotes.map((quote) => [quote.id, quote]));

  const { data: versions, error: versionsError } = await supabase
    .from("quote_versions")
    .select("quote_id, version_number, version_status, total")
    .in("quote_id", quoteIds);

  if (versionsError) {
    errors.push(`Quote versions: ${versionsError.message}`);

    return {
      quotesSent: emptyMetric(),
      quotesAccepted: emptyMetric(),
      errors,
    };
  }

  const sentRows: { total: number }[] = [];
  const acceptedRows: { total: number }[] = [];

  for (const version of versions ?? []) {
    const quote = quoteById.get(version.quote_id);

    if (!quote) {
      continue;
    }

    const total = Number(version.total ?? 0);

    if (matchCurrentVersion(quote, version, "sent", "sent")) {
      sentRows.push({ total });
      continue;
    }

    if (matchCurrentVersion(quote, version, "accepted", "accepted")) {
      acceptedRows.push({ total });
    }
  }

  return {
    quotesSent: buildMetric(sentRows),
    quotesAccepted: buildMetric(acceptedRows),
    errors,
  };
}
