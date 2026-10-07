import type { SupabaseClient } from "@supabase/supabase-js";

import type { PriceComparison } from "@/lib/materials/invoices/model";

export async function recordPriceChangeDetections(
  supabase: SupabaseClient,
  input: {
    invoiceId: string;
    actorId: string | null;
    invoiceDate: string | null;
    lines: readonly {
      id: string;
      previousStatus: string | null;
      reviewStatus: string;
      productId: string | null;
      comparison: PriceComparison | null;
    }[];
  }
) {
  const rows = input.lines
    .filter(
      (line) =>
        line.reviewStatus === "price_change" &&
        line.previousStatus !== "price_change" &&
        line.comparison
    )
    .map((line) => ({
      invoice_id: input.invoiceId,
      invoice_line_id: line.id,
      actor_id: input.actorId,
      action: "price_change_detected",
      metadata: {
        productId: line.productId,
        currentPriceId: line.comparison?.currentPriceId ?? null,
        currentPrice: line.comparison?.currentPrice ?? null,
        currentEffectiveDate: line.comparison?.currentEffectiveDate ?? null,
        invoicePrice: line.comparison?.invoicePrice ?? null,
        priceUnit: line.comparison?.priceUnit ?? null,
        difference: line.comparison?.difference ?? null,
        percent: line.comparison?.percent ?? null,
        invoiceDate: input.invoiceDate,
      },
    }));

  if (rows.length === 0) {
    return;
  }

  await supabase.from("supplier_invoice_events").insert(rows);
}
