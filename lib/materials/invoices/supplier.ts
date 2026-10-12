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

/**
 * Invoice-only supplier evidence. These domains are not supplier aliases:
 * the bare token APS must not resolve to All Print Supplies.
 */
const INVOICE_SUPPLIER_DOMAINS = [
  { domain: "allprint.co.uk", canonicalName: "All Print Supplies" },
] as const;

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
      documentLabel: null,
      warning,
    };
  }

  if (labeled) {
    const match = findSupplier(labeled, suppliers, aliases);

    if (match) {
      return { supplierId: match.id, supplierName: match.name, documentLabel: null, warning: null };
    }

    return {
      supplierId: null,
      supplierName: null,
      documentLabel: null,
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
  const domainHits = domainSuppliers(documentText, suppliers);
  const unique = new Map(
    [...hits, ...aliasHits, ...domainHits.map((hit) => hit.supplier)].map((supplier) => [
      supplier.id,
      supplier,
    ])
  );

  if (unique.size === 1) {
    const supplier = [...unique.values()][0];
    const domainLabel = domainHits.find((hit) => hit.supplier.id === supplier.id)?.evidence ?? null;
    const phraseLabel = longestDocumentPhrase(documentText, suppliers, aliases, supplier.id);
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      documentLabel: longerLabel(phraseLabel, domainLabel),
      warning: null,
    };
  }

  if (unique.size > 1) {
    return {
      supplierId: null,
      supplierName: null,
      documentLabel: null,
      warning: "More than one supplier name appears on this invoice.",
    };
  }

  return {
    supplierId: null,
    supplierName: null,
    documentLabel: null,
    warning: "The supplier was not found on this invoice.",
  };
}

function longestDocumentPhrase(
  text: string,
  suppliers: readonly InvoiceSupplierRef[],
  aliases: readonly InvoiceAliasRef[],
  supplierId: string
) {
  const phrases = [
    ...suppliers.filter((supplier) => supplier.id === supplierId).map((supplier) => supplier.name),
    ...aliases.filter((alias) => alias.supplierId === supplierId).map((alias) => alias.alias),
  ];

  return (
    phrases
      .filter((phrase) => phraseAppears(text, phrase))
      .sort((left, right) => right.length - left.length)[0] ?? null
  );
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

function domainSuppliers(text: string, suppliers: readonly InvoiceSupplierRef[]) {
  return INVOICE_SUPPLIER_DOMAINS.flatMap((identity) => {
    const evidence = domainEvidence(text, identity.domain);

    if (!evidence) {
      return [];
    }

    const supplier = suppliers.find(
      (item) => item.normalizedName === normalizeSupplierName(identity.canonicalName)
    );

    return supplier ? [{ supplier, evidence }] : [];
  });
}

function domainEvidence(text: string, domain: string) {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(
      `(?:^|[^a-z0-9.])((?:[a-z0-9._%+-]+@|(?:https?:\\/\\/)?(?:www\\.)?)${escaped})(?![a-z0-9.])`,
      "i"
    )
  );

  return match?.[1] ?? null;
}

function longerLabel(left: string | null, right: string | null) {
  return [left, right]
    .filter((value): value is string => Boolean(value))
    .sort((first, second) => second.length - first.length)[0] ?? null;
}

function phraseAppears(text: string, phrase: string) {
  const normalizedText = normalizeSupplierName(text);
  const normalizedPhrase = normalizeSupplierName(phrase);

  if (!normalizedPhrase || isBlockedSupplierName(normalizedPhrase)) {
    return false;
  }

  return normalizedText.includes(normalizedPhrase);
}
