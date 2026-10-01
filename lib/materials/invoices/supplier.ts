import { normalizeSupplierName } from "@/lib/materials/identity";

import type {
  InvoiceAliasRef,
  InvoiceSupplierRef,
} from "@/lib/materials/invoices/model";

const BLOCKED_SUPPLIER_NAMES = new Set([
  "candid creative",
  "candid creative ltd",
  "candid creative ltd.",
  "aps",
]);

export function isBlockedSupplierName(value: string) {
  return BLOCKED_SUPPLIER_NAMES.has(normalizeSupplierName(value));
}

export function resolveInvoiceSupplier(
  rawSupplierName: string | null,
  documentText: string,
  suppliers: readonly InvoiceSupplierRef[],
  aliases: readonly InvoiceAliasRef[]
) {
  const labeled = rawSupplierName ? normalizeSupplierName(rawSupplierName) : "";

  if (labeled && isBlockedSupplierName(labeled)) {
    const warning = labeled === "aps"
      ? "APS is not treated as All Print Supplies. Choose the supplier that issued this invoice."
      : `${rawSupplierName} is not an external supplier. Choose the supplier that issued this invoice.`;

    return {
      supplierId: null,
      supplierName: null,
      warning,
    };
  }

  if (labeled) {
    const match = findSupplier(labeled, suppliers, aliases);

    if (match) {
      return { supplierId: match.id, supplierName: match.name, warning: null };
    }

    return {
      supplierId: null,
      supplierName: null,
      warning: `No supplier matched “${rawSupplierName}”.`,
    };
  }

  const hits = suppliers.filter((supplier) =>
    phraseAppears(documentText, supplier.name)
  );
  const aliasHits = aliases.flatMap((alias) => {
    if (!phraseAppears(documentText, alias.alias)) {
      return [];
    }

    const supplier = suppliers.find((item) => item.id === alias.supplierId);
    return supplier ? [supplier] : [];
  });
  const unique = new Map(
    [...hits, ...aliasHits].map((supplier) => [supplier.id, supplier])
  );

  if (unique.size === 1) {
    const supplier = [...unique.values()][0];
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      warning: null,
    };
  }

  if (unique.size > 1) {
    return {
      supplierId: null,
      supplierName: null,
      warning: "More than one supplier name appears on this invoice.",
    };
  }

  return {
    supplierId: null,
    supplierName: null,
    warning: "The supplier was not found on this invoice.",
  };
}

function findSupplier(
  normalized: string,
  suppliers: readonly InvoiceSupplierRef[],
  aliases: readonly InvoiceAliasRef[]
) {
  const byName = suppliers.find((supplier) => supplier.normalizedName === normalized);

  if (byName) {
    return byName;
  }

  const alias = aliases.find((item) => item.normalizedAlias === normalized);

  if (!alias) {
    return null;
  }

  return suppliers.find((supplier) => supplier.id === alias.supplierId) ?? null;
}

function phraseAppears(text: string, phrase: string) {
  const normalizedText = normalizeSupplierName(text);
  const normalizedPhrase = normalizeSupplierName(phrase);

  if (!normalizedPhrase || isBlockedSupplierName(normalizedPhrase)) {
    return false;
  }

  return normalizedText.includes(normalizedPhrase);
}
