import { normalizeSupplierName } from "@/lib/materials/identity";

/**
 * Explicit supplier spellings found on invoice lines.
 * APS is not included: it has not been confirmed as All Print Supplies.
 * Suffixes are not stripped automatically. Only these spellings resolve.
 */
export const KNOWN_SUPPLIER_FAMILIES = [
  {
    canonicalName: "Pyramid Display Materials",
    aliases: [
      "Pyramid Display",
      "Pyramid Display Materials Ltd.",
      "Pyramid Display Materials Ltd",
    ],
  },
  {
    canonicalName: "Antalis",
    aliases: ["Antalis Ltd", "Antalis Ltd."],
  },
  {
    canonicalName: "Perfect Colours",
    aliases: ["Perfect Colours Ltd", "Perfect Colours Ltd."],
  },
  {
    canonicalName: "Papergraphics",
    aliases: [
      "Papergraphics Limited",
      "Papergraphics Ltd",
      "Papergraphics Ltd.",
    ],
  },
  {
    canonicalName: "PPB",
    aliases: ["PPB Ltd", "PPB Ltd."],
  },
  {
    canonicalName: "All Print Supplies",
    aliases: ["All Print Supplies Ltd", "All Print Supplies Ltd."],
  },
] as const;

export function resolveKnownSupplierName(value: string) {
  const normalized = normalizeSupplierName(value);

  if (!normalized) {
    return null;
  }

  for (const family of KNOWN_SUPPLIER_FAMILIES) {
    if (normalizeSupplierName(family.canonicalName) === normalized) {
      return family.canonicalName;
    }

    if (
      family.aliases.some((alias) => normalizeSupplierName(alias) === normalized)
    ) {
      return family.canonicalName;
    }
  }

  return null;
}

export type SupplierAliasEntry = {
  canonicalName: string;
  alias: string;
};

/**
 * Same alias key as public.supplier_aliases_normalize:
 * trim, collapse internal whitespace, then lowercase.
 * Punctuation is kept, so "Ltd" and "Ltd." stay distinct.
 */
export function supplierAliasKey(value: string) {
  return normalizeSupplierName(value);
}

export type SupplierAliasCollision =
  | {
      normalized: string;
      kind: "same-supplier";
      canonicalName: string;
      aliases: string[];
    }
  | {
      normalized: string;
      kind: "cross-supplier";
      canonicalNames: string[];
      aliases: string[];
    };

export function findSupplierAliasCollisions(
  entries: readonly SupplierAliasEntry[]
): SupplierAliasCollision[] {
  const groups = new Map<string, SupplierAliasEntry[]>();

  for (const entry of entries) {
    const key = supplierAliasKey(entry.alias);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const collisions: SupplierAliasCollision[] = [];

  for (const [normalized, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    const canonicalNames = [
      ...new Set(group.map((entry) => entry.canonicalName)),
    ];
    const canonicalKeys = new Set(
      canonicalNames.map((name) => supplierAliasKey(name))
    );

    if (canonicalKeys.size > 1) {
      collisions.push({
        normalized,
        kind: "cross-supplier",
        canonicalNames,
        aliases: group.map((entry) => entry.alias),
      });
      continue;
    }

    collisions.push({
      normalized,
      kind: "same-supplier",
      canonicalName: canonicalNames[0],
      aliases: group.map((entry) => entry.alias),
    });
  }

  return collisions;
}
