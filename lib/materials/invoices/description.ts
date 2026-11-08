import { normalizeMaterialLabel } from "@/lib/materials/identity";

const SERVICE_NOTE =
  /\s*(?:\b(?:both\s+)?slit\s+to\s+(?:\d+\s*@\s*)?\d+(?:\.\d+)?\s*mm\b|\bprice\s+due\s+to\s+stock\b)/gi;

export function invoiceCatalogDescription(description: string) {
  const stripped = description.replace(SERVICE_NOTE, " ").replace(/\s{2,}/g, " ").trim();
  return normalizeMaterialLabel(stripped) ?? stripped;
}

export function invoiceServiceNotes(description: string) {
  const matches = [...description.matchAll(SERVICE_NOTE)].map((match) => match[0].trim());

  return matches.filter(Boolean).join(" ").trim() || null;
}
