import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PERMANENT_LINE_ACTIONS,
  reprocessBlockReason,
} from "@/lib/materials/invoices/price-change";

export async function permanentInvoiceLineIds(
  supabase: SupabaseClient,
  invoiceId: string
) {
  const { data: lines, error: lineError } = await supabase
    .from("supplier_invoice_lines")
    .select("id")
    .eq("invoice_id", invoiceId);

  if (lineError || !lines || lines.length === 0) {
    return new Set<string>();
  }

  const lineIds = lines.map((line) => line.id as string);
  const [prices, mappings, ignoreRules, events] = await Promise.all([
    supabase
      .from("material_prices")
      .select("source_reference")
      .eq("source_type", "supplier_invoice")
      .in("source_reference", lineIds),
    supabase
      .from("supplier_product_description_mappings")
      .select("created_from_invoice_line_id")
      .in("created_from_invoice_line_id", lineIds),
    supabase
      .from("supplier_invoice_ignore_rules")
      .select("created_from_invoice_line_id")
      .in("created_from_invoice_line_id", lineIds),
    supabase
      .from("supplier_invoice_events")
      .select("invoice_line_id, action")
      .eq("invoice_id", invoiceId)
      .in("action", [...PERMANENT_LINE_ACTIONS]),
  ]);
  const locked = new Set<string>();

  for (const row of prices.data ?? []) {
    if (row.source_reference) locked.add(row.source_reference);
  }

  for (const row of mappings.data ?? []) {
    if (row.created_from_invoice_line_id) locked.add(row.created_from_invoice_line_id);
  }

  for (const row of ignoreRules.data ?? []) {
    if (row.created_from_invoice_line_id) locked.add(row.created_from_invoice_line_id);
  }

  for (const row of events.data ?? []) {
    if (row.invoice_line_id) locked.add(row.invoice_line_id);
  }

  return locked;
}

export async function findInvoiceReprocessBlock(
  supabase: SupabaseClient,
  invoiceId: string
) {
  const { data: lines, error: lineError } = await supabase
    .from("supplier_invoice_lines")
    .select("id")
    .eq("invoice_id", invoiceId);

  if (lineError) {
    return "Invoice lines could not be checked, so reprocessing was stopped.";
  }

  const lineIds = (lines ?? []).map((line) => line.id as string);

  if (lineIds.length === 0) {
    return null;
  }

  const [prices, mappings, ignoreRules, events] = await Promise.all([
    supabase
      .from("material_prices")
      .select("source_reference")
      .eq("source_type", "supplier_invoice")
      .in("source_reference", lineIds),
    supabase
      .from("supplier_product_description_mappings")
      .select("created_from_invoice_line_id")
      .in("created_from_invoice_line_id", lineIds),
    supabase
      .from("supplier_invoice_ignore_rules")
      .select("created_from_invoice_line_id")
      .in("created_from_invoice_line_id", lineIds),
    supabase
      .from("supplier_invoice_events")
      .select("action, invoice_line_id")
      .eq("invoice_id", invoiceId)
      .in("action", [...PERMANENT_LINE_ACTIONS]),
  ]);
  const error = prices.error ?? mappings.error ?? ignoreRules.error ?? events.error;

  if (error) {
    return "Invoice lines could not be checked, so reprocessing was stopped.";
  }

  return reprocessBlockReason({
    lineIds,
    invoicePriceLineIds: (prices.data ?? [])
      .map((row) => row.source_reference as string | null)
      .filter((lineId): lineId is string => Boolean(lineId)),
    mappingLineIds: (mappings.data ?? [])
      .map((row) => row.created_from_invoice_line_id as string | null)
      .filter((lineId): lineId is string => Boolean(lineId)),
    ignoreRuleLineIds: (ignoreRules.data ?? [])
      .map((row) => row.created_from_invoice_line_id as string | null)
      .filter((lineId): lineId is string => Boolean(lineId)),
    events: (events.data ?? []).map((row) => ({
      lineId: row.invoice_line_id as string | null,
      action: row.action as string,
    })),
  });
}
