import type { PricingSource } from "@/lib/invoice/constants";
import type { InvoiceItemRecord } from "@/lib/invoice/types";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import { MANIFEST_SOURCE_TYPE_LABELS } from "@/lib/manifest/constants";
import type { ManifestSourceType } from "@/lib/manifest/constants";

export function buildInvoiceDescriptionFromManifestItem(
  item: ManifestItemRecord
): string | null {
  const parts: string[] = [];

  if (item.description?.trim()) {
    parts.push(item.description.trim());
  }

  const detailLines: string[] = [];

  if (item.material?.trim()) {
    detailLines.push(`Material: ${item.material.trim()}`);
  }

  if (item.width_mm !== null && item.height_mm !== null) {
    detailLines.push(`Dimensions: ${item.width_mm}mm × ${item.height_mm}mm`);
  } else if (item.width_mm !== null) {
    detailLines.push(`Width: ${item.width_mm}mm`);
  } else if (item.height_mm !== null) {
    detailLines.push(`Height: ${item.height_mm}mm`);
  }

  if (item.quantity !== null) {
    detailLines.push(`Quantity: ${item.quantity}`);
  }

  if (item.unit?.trim()) {
    detailLines.push(`Unit: ${item.unit.trim()}`);
  }

  if (item.finishing_notes?.trim()) {
    detailLines.push(`Finishing: ${item.finishing_notes.trim()}`);
  }

  if (item.internal_note?.trim()) {
    detailLines.push(`Notes: ${item.internal_note.trim()}`);
  }

  if (detailLines.length > 0) {
    parts.push(detailLines.join("\n"));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

export function buildInvoiceLineFromManifestItem(item: ManifestItemRecord) {
  return {
    item_name: item.item_name.trim(),
    description: buildInvoiceDescriptionFromManifestItem(item),
  };
}

export function getInvoiceLineSourceLabel(
  line: Pick<InvoiceItemRecord, "pricing_source" | "quote_item_id">,
  manifestItem?: ManifestItemRecord | null
) {
  if (
    line.pricing_source === "no_charge" ||
    manifestItem?.billing_status === "reprint_no_charge"
  ) {
    return "No-charge reprint";
  }

  if (manifestItem?.source_type === "quoted" || line.quote_item_id) {
    return "Accepted quote";
  }

  if (manifestItem?.source_type === "additional") {
    return "Additional production item";
  }

  if (manifestItem?.source_type === "replacement") {
    return "Replacement";
  }

  if (manifestItem?.source_type === "reprint") {
    return "Reprint";
  }

  if (manifestItem?.source_type === "external") {
    return "External production item";
  }

  if (line.pricing_source === "manual") {
    return "Manual charge";
  }

  if (manifestItem?.source_type) {
    return MANIFEST_SOURCE_TYPE_LABELS[manifestItem.source_type as ManifestSourceType];
  }

  return "Manual charge";
}

export function buildXeroLineDescription(
  line: Pick<InvoiceItemRecord, "item_name" | "description">
) {
  const title = line.item_name.trim();
  const body = line.description?.trim() ?? "";

  if (!body || body === title) {
    return title;
  }

  return `${title}\n${body}`;
}

export function isManualPricingSource(pricingSource: PricingSource) {
  return (
    pricingSource === "manual" ||
    pricingSource === "calculator" ||
    pricingSource === "customer_price_rule"
  );
}

export function formatManifestPreviewDescription(item: ManifestItemRecord) {
  return buildInvoiceDescriptionFromManifestItem(item) ?? item.item_name;
}
