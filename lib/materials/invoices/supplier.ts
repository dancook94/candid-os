import { normalizeSupplierName } from "@/lib/materials/identity";

import type {
  InvoiceAliasRef,
  InvoiceSupplierRef,
} from "@/lib/materials/invoices/model";

const BLOCKED_SUPPLIER_NAMES = new Set([
  "candid creative",
  "candid creative ltd",
  "candid creative ltd.",
  "candid creative limited",
  "aps",
]);

/**
 * Invoice-only supplier evidence. These domains are not supplier aliases:
 * the bare token APS must not resolve to All Print Supplies.
 */
const INVOICE_SUPPLIER_DOMAINS = [
  { domain: "allprint.co.uk", canonicalName: "All Print Supplies" },
  { domain: "pyramid-display.co.uk", canonicalName: "Pyramid Display Materials" },
  { domain: "ppb.co.uk", canonicalName: "PPB" },
] as const;

const DELIVERY_SECTION =
  /(?:^|\n)\s*(?:ship(?:ping)?\s*-?\s*to|deliver(?:y)?\s+(?:to|address)|bill\s*-?\s*to(?:\s+customer)?)\b[\s\S]*?(?=(?:^|\n)\s*(?:invoice|document|account|sales|unit price|no\.|quantity)\b|$)/gi;

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

  const issuerText = issuerDocumentText(documentText);
  const ranked = rankSupplierEvidence(issuerText, documentText, suppliers, aliases);

  if (ranked.length === 0) {
    return {
      supplierId: null,
      supplierName: null,
      documentLabel: null,
      warning: "The supplier was not found on this invoice.",
    };
  }

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (runnerUp && runnerUp.score === best.score) {
    return {
      supplierId: null,
      supplierName: null,
      documentLabel: null,
      warning: "More than one supplier name appears on this invoice.",
    };
  }

  if (runnerUp && best.score - runnerUp.score < 2) {
    return {
      supplierId: null,
      supplierName: null,
      documentLabel: null,
      warning: "More than one supplier name appears on this invoice.",
    };
  }

  const domainLabel = best.domainEvidence ?? null;
  const phraseLabel = longestDocumentPhrase(documentText, suppliers, aliases, best.supplier.id);

  return {
    supplierId: best.supplier.id,
    supplierName: best.supplier.name,
    documentLabel: phraseLabel ?? domainLabel,
    warning: null,
  };
}

export function resolveHistoricalSupplier(input: {
  text: string;
  filename?: string | null;
  sender?: string | null;
  rawSupplierName?: string | null;
  suppliers: readonly InvoiceSupplierRef[];
  aliases: readonly InvoiceAliasRef[];
}) {
  const fromText = resolveInvoiceSupplier(
    input.rawSupplierName ?? null,
    input.text,
    input.suppliers,
    input.aliases
  );
  const context = [input.filename, input.sender].filter((value) => value?.trim()).join("\n");
  const fromContext = context
    ? resolveInvoiceSupplier(null, context, input.suppliers, input.aliases)
    : null;
  const blocked = Boolean(
    input.rawSupplierName && isBlockedSupplierName(input.rawSupplierName)
  );

  if (
    fromText.supplierId &&
    fromContext?.supplierId &&
    fromText.supplierId !== fromContext.supplierId
  ) {
    return {
      supplierId: null,
      supplierName: null,
      documentLabel: null,
      warning: "The file and the invoice name different suppliers.",
    };
  }

  if (fromText.supplierId || blocked || fromText.warning?.includes("More than one")) {
    return fromText;
  }

  if (input.rawSupplierName?.trim()) {
    return fromText;
  }

  return fromContext?.supplierId ? fromContext : fromText;
}

function issuerDocumentText(documentText: string) {
  return documentText.replace(DELIVERY_SECTION, "\n");
}

type SupplierScore = {
  supplier: InvoiceSupplierRef;
  score: number;
  domainEvidence: string | null;
};

function rankSupplierEvidence(
  issuerText: string,
  fullText: string,
  suppliers: readonly InvoiceSupplierRef[],
  aliases: readonly InvoiceAliasRef[]
) {
  const scores = new Map<string, SupplierScore>();

  const note = (supplier: InvoiceSupplierRef, points: number, domainEvidence?: string | null) => {
    const current = scores.get(supplier.id) ?? {
      supplier,
      score: 0,
      domainEvidence: null,
    };
    current.score += points;

    if (domainEvidence) {
      current.domainEvidence = longerLabel(current.domainEvidence, domainEvidence);
    }

    scores.set(supplier.id, current);
  };

  for (const supplier of suppliers) {
    if (phraseAppears(issuerText, supplier.name)) {
      note(supplier, 2);
    }
  }

  for (const alias of aliases) {
    if (!phraseAppears(issuerText, alias.alias)) {
      continue;
    }

    const supplier = suppliers.find((item) => item.id === alias.supplierId);

    if (supplier) {
      note(supplier, 2);
    }
  }

  for (const hit of domainSuppliers(fullText, suppliers)) {
    note(hit.supplier, 5, hit.evidence);
  }

  for (const hit of domainSuppliers(issuerText, suppliers)) {
    note(hit.supplier, 3, hit.evidence);
  }

  return [...scores.values()].sort((left, right) => right.score - left.score);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
