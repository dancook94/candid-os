import {
  normalizeSupplierDescription,
  normalizeSupplierName,
} from "@/lib/materials/identity";
import {
  deferredSupplierAliases,
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_CONFIRMATION,
  INITIAL_IMPORT_MATERIALS,
  INITIAL_IMPORT_PRICE_TOLERANCE,
  PROTECTED_FOAMALITE,
  PROTECTED_FOAMALITE_IDENTITY,
  PROTECTED_SUPPLIER_DESCRIPTIONS,
  initialImportAliases,
  initialImportIdentity,
  initialImportSupplierNames,
  type InitialImportMaterial,
} from "@/lib/materials/initial-import-catalog";
import {
  MEDIUM_IMPORT_CATALOG_VERSION,
  mediumImportSource,
  mediumImportSupplierNames,
} from "@/lib/materials/medium-import-catalog";
import type { ApprovedImportCatalogVersion } from "@/lib/materials/import-batches";
import {
  calculateCostPerLitre,
  calculateCostPerSquareMetre,
} from "@/lib/materials/pricing";
import {
  formatCostPerLitre,
  formatCostPerSquareMetre,
  formatMaterialSpecification,
  formatPurchaseFormat,
  type MaterialRecord,
} from "@/lib/materials/present";
import {
  findSupplierAliasCollisions,
  supplierAliasKey,
} from "@/lib/materials/supplier-aliases";
import type { PurchaseUnit } from "@/lib/materials/units";

export type InitialImportSnapshot = {
  aliasesReady: boolean;
  suppliers: Array<{ id: string; name: string; normalizedName: string }>;
  aliases: Array<{
    supplierId: string;
    alias: string;
    normalizedAlias: string;
  }>;
  materials: Array<{
    id: string;
    name: string;
    identityKey: string;
    active: boolean;
  }>;
  products: Array<{
    id: string;
    materialId: string;
    supplierId: string;
    description: string;
    normalizedDescription: string;
    isPreferred: boolean;
    active: boolean;
  }>;
  prices: Array<{
    productId: string;
    price: number;
    priceUnit: string;
  }>;
};

export type ImportRowAction = "create" | "match" | "conflict" | "deferred";
export type ImportMaterialAction =
  | "create"
  | "extend"
  | "already_matched"
  | "conflict"
  | "invalid";

export type InitialImportPlan = {
  catalogVersion: string;
  effectiveDate: string;
  canCommit: boolean;
  blockedReason: string | null;
  aliasesReady: boolean;
  importStatus?: {
    runsReady: boolean;
    completedCatalogVersions: string[];
    batch1Completed: boolean;
  };
  suppliers: Array<{
    name: string;
    action: "create" | "match" | "conflict";
    existingId: string | null;
    note: string;
  }>;
  aliases: Array<{
    canonicalName: string;
    alias: string;
    action: ImportRowAction;
    note: string;
  }>;
  materials: Array<{
    key: string;
    name: string;
    category: string | null;
    specification: string;
    purchaseFormat: string;
    purchaseUnit: PurchaseUnit;
    widthMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
    inkVolumeLitres: number | null;
    action: ImportMaterialAction;
    note: string;
    existingMaterialId: string | null;
    products: Array<{
      key: string;
      supplierName: string;
      supplierDescription: string;
      price: number;
      priceUnit: PurchaseUnit;
      preferred: boolean;
      costPerSquareMetre: number | null;
      costPerSquareMetreLabel: string;
      costPerLitre: number | null;
      costPerLitreLabel: string;
      action: ImportMaterialAction;
      note: string;
    }>;
  }>;
  preserved: Array<{ name: string; note: string }>;
  skipped: Array<{ label: string; reason: string }>;
  counts: {
    suppliersToCreate: number;
    suppliersMatched: number;
    aliasesToCreate: number;
    aliasesMatched: number;
    materialsToCreate: number;
    productsToCreate: number;
    pricesToCreate: number;
    alreadyMatched: number;
    conflicts: number;
  };
  warnings: string[];
  errors: string[];
};

export type InitialImportPayload = {
  catalogVersion: string;
  confirmation: string;
  effectiveDate: string;
  suppliers: Array<
    | { action: "create"; name: string }
    | { action: "match"; name: string; expectedId: string }
  >;
  createAliases: Array<{ canonicalName: string; alias: string }>;
  createMaterialKeys: string[];
  createProductKeys: string[];
};

export type CatalogImportSource = {
  catalogVersion: string;
  materials: readonly InitialImportMaterial[];
  supplierNames: readonly string[];
  aliases: readonly { canonicalName: string; alias: string }[];
  deferredAliases: readonly { canonicalName: string; alias: string }[];
  skipped: InitialImportPlan["skipped"];
};

export function defaultInitialImportSource(): CatalogImportSource {
  return {
    catalogVersion: INITIAL_IMPORT_CATALOG_VERSION,
    materials: INITIAL_IMPORT_MATERIALS,
    supplierNames: initialImportSupplierNames(),
    aliases: initialImportAliases(),
    deferredAliases: deferredSupplierAliases(),
    skipped: [
      {
        label: "44 medium-confidence materials",
        reason:
          "These descriptions were not approved. They are not in this catalog.",
      },
      {
        label: "6 unresolved descriptions",
        reason:
          "Lumex, Expanse, Digiflor, Novatec, and the slit blackback lines stay out until they can be identified.",
      },
      {
        label: "Ignored rows",
        reason:
          "Subscriptions, service plans, meter readings, and other non-material lines are not imported.",
      },
      {
        label: "Foamalite 5mm 3050 × 1560 spreadsheet rows",
        reason:
          "Both descriptions, including (PQ80), are excluded. The live record is not given another price.",
      },
      {
        label: "Known outlier prices",
        reason:
          "Outliers such as Dibond £38.79, Dibond Eco £60.46, and HIPS pack totals are not used as opening prices.",
      },
    ],
  };
}

function pricesClose(left: number, right: number) {
  return Math.abs(left - right) <= INITIAL_IMPORT_PRICE_TOLERANCE;
}

function asMaterialRecord(material: InitialImportMaterial): MaterialRecord {
  return {
    id: material.key,
    name: material.name,
    category: material.category,
    thicknessMm: material.thicknessMm,
    colour: material.colour,
    finish: material.finish,
    purchaseUnit: material.purchaseUnit,
    purchaseWidthMm: material.purchaseWidthMm,
    purchaseHeightMm: material.purchaseHeightMm,
    purchaseLengthMm: material.purchaseLengthMm,
    active: true,
  };
}

function validateMaterial(material: InitialImportMaterial) {
  const errors: string[] = [];
  const preferredCount = material.products.filter((product) => product.preferred)
    .length;

  if (material.products.length === 0) {
    errors.push("A material needs at least one supplier product.");
  }

  if (preferredCount !== 1) {
    errors.push("A material needs exactly one preferred supplier product.");
  }

  if (material.purchaseUnit === "sheet") {
    if (
      material.purchaseWidthMm == null ||
      !(material.purchaseWidthMm > 0) ||
      material.purchaseHeightMm == null ||
      !(material.purchaseHeightMm > 0) ||
      material.purchaseLengthMm != null
    ) {
      errors.push("A sheet needs width and height, and no roll length.");
    }
  }

  if (material.purchaseUnit === "roll") {
    if (
      material.purchaseWidthMm == null ||
      !(material.purchaseWidthMm > 0) ||
      material.purchaseLengthMm == null ||
      !(material.purchaseLengthMm > 0) ||
      material.purchaseHeightMm != null
    ) {
      errors.push("A roll needs width and length, and no sheet height.");
    }
  }

  if (material.purchaseUnit === "linear_metre") {
    if (
      material.purchaseWidthMm == null ||
      !(material.purchaseWidthMm > 0) ||
      material.purchaseHeightMm != null ||
      material.purchaseLengthMm != null
    ) {
      errors.push(
        "A linear metre needs a width, and no sheet height or roll length."
      );
    }
  }

  if (initialImportIdentity(material) === PROTECTED_FOAMALITE_IDENTITY) {
    errors.push("This identity is the protected Foamalite record.");
  }

  const products = material.products.map((product) => {
    const productErrors: string[] = [];

    if (!(product.price > 0) || !Number.isFinite(product.price)) {
      productErrors.push("Price must be greater than zero.");
    }

    if (product.priceUnit !== material.purchaseUnit) {
      productErrors.push("Price unit must match the purchase unit.");
    }

    const description = normalizeSupplierDescription(product.supplierDescription);

    if (PROTECTED_SUPPLIER_DESCRIPTIONS.includes(description)) {
      productErrors.push(
        "This description belongs to the protected Foamalite record."
      );
    }

    const costPerSquareMetre = calculateCostPerSquareMetre({
      price: product.price,
      priceUnit: product.priceUnit,
      widthMm: material.purchaseWidthMm,
      heightMm: material.purchaseHeightMm,
      lengthMm: material.purchaseLengthMm,
    });
    const costPerLitre = calculateCostPerLitre(
      product.price,
      material.inkVolumeLitres
    );

    if (
      product.priceUnit === "sheet" ||
      product.priceUnit === "roll" ||
      product.priceUnit === "linear_metre"
    ) {
      if (
        costPerSquareMetre == null ||
        product.expectedCostPerSquareMetre == null ||
        !pricesClose(costPerSquareMetre, product.expectedCostPerSquareMetre)
      ) {
        productErrors.push(
          "Calculated £/m² does not match the approved figure."
        );
      }
    } else if (product.expectedCostPerSquareMetre != null) {
      productErrors.push("This purchase unit does not store a £/m² price.");
    }

    if (material.inkVolumeLitres != null) {
      if (
        costPerLitre == null ||
        product.expectedCostPerLitre == null ||
        !pricesClose(costPerLitre, product.expectedCostPerLitre)
      ) {
        productErrors.push("Calculated £/litre does not match the approved figure.");
      }
    } else if (product.expectedCostPerLitre != null) {
      productErrors.push("This material has no ink volume.");
    }

    return {
      ...product,
      costPerSquareMetre,
      costPerLitre,
      errors: productErrors,
    };
  });

  return { errors, products };
}

export function buildInitialImportPlan(
  snapshot: InitialImportSnapshot,
  effectiveDate: string,
  source: CatalogImportSource = defaultInitialImportSource()
): InitialImportPlan {
  const warnings: string[] = [];
  const errors: string[] = [];
  const suppliersByName = new Map(
    snapshot.suppliers.map((supplier) => [supplier.normalizedName, supplier])
  );
  const aliasesByName = new Map(
    snapshot.aliases.map((alias) => [alias.normalizedAlias, alias])
  );
  const materialsByIdentity = new Map(
    snapshot.materials.map((material) => [material.identityKey, material])
  );

  const supplierPlans: InitialImportPlan["suppliers"] =
    source.supplierNames.map((name) => {
    const existing = suppliersByName.get(normalizeSupplierName(name)) ?? null;

    if (!existing) {
      return {
        name,
        action: "create" as const,
        existingId: null,
        note: "New canonical supplier.",
      };
    }

    return {
      name,
      action: "match" as const,
      existingId: existing.id,
      note: `Matches existing supplier “${existing.name}”.`,
    };
  });

  const approvedAliases = source.aliases;
  const aliasCollisions = findSupplierAliasCollisions(approvedAliases);
  const aliasPlans = [
    ...approvedAliases.map((entry) => {
      const canonical = suppliersByName.get(
        normalizeSupplierName(entry.canonicalName)
      );
      const normalizedAlias = supplierAliasKey(entry.alias);
      const collision = aliasCollisions.find(
        (item) => item.normalized === normalizedAlias
      );
      const existingAlias = aliasesByName.get(normalizedAlias) ?? null;

      if (collision) {
        return {
          ...entry,
          action: "conflict" as const,
          note:
            collision.kind === "cross-supplier"
              ? "This alias matches a different supplier once case and spacing are normalised."
              : "This spelling is the same alias as another row once case and spacing are normalised.",
        };
      }
      const supplierUsingAlias = suppliersByName.get(normalizedAlias) ?? null;
      const canonicalId = canonical?.id ?? null;

      if (
        supplierUsingAlias &&
        (!canonicalId || supplierUsingAlias.id !== canonicalId)
      ) {
        return {
          ...entry,
          action: "conflict" as const,
          note: `“${entry.alias}” is already a different supplier.`,
        };
      }

      if (existingAlias) {
        if (canonicalId && existingAlias.supplierId === canonicalId) {
          return {
            ...entry,
            action: "match" as const,
            note: "Alias already points at this supplier.",
          };
        }

        if (!canonicalId) {
          return {
            ...entry,
            action: "conflict" as const,
            note: "Alias already exists, and the canonical supplier was not found.",
          };
        }

        return {
          ...entry,
          action: "conflict" as const,
          note: "Alias already points at a different supplier.",
        };
      }

      if (!snapshot.aliasesReady) {
        return {
          ...entry,
          action: "create" as const,
          note: "Will be created after the supplier aliases migration is applied.",
        };
      }

      return {
        ...entry,
        action: "create" as const,
        note: canonical
          ? "Will be added to the existing supplier."
          : "Will be added when the supplier is created.",
      };
    }),
    ...source.deferredAliases.map((entry) => ({
      ...entry,
      action: "deferred" as const,
      note: "This supplier is not part of the approved import, so no alias row is created.",
    })),
  ];

  const materialPlans = source.materials.map((material) => {
    const validation = validateMaterial(material);
    const record = asMaterialRecord(material);
    const identity = initialImportIdentity(material);
    const existingMaterial = materialsByIdentity.get(identity) ?? null;
    const materialErrors = [...validation.errors];

    const products = validation.products.map((product) => {
      const base = {
        key: product.key,
        supplierName: product.supplierName,
        supplierDescription: product.supplierDescription,
        price: product.price,
        priceUnit: product.priceUnit,
        preferred: product.preferred,
        costPerSquareMetre: product.costPerSquareMetre,
        costPerSquareMetreLabel: formatCostPerSquareMetre(
          product.costPerSquareMetre
        ),
        costPerLitre: product.costPerLitre,
        costPerLitreLabel: formatCostPerLitre(product.costPerLitre),
      };

      if (materialErrors.length > 0 || product.errors.length > 0) {
        return {
          ...base,
          action: "invalid" as const,
          note: [...materialErrors, ...product.errors].join(" "),
        };
      }

      const supplier = supplierPlans.find(
        (item) => item.name === product.supplierName
      );
      const supplierId = supplier?.existingId ?? null;
      const normalizedDescription = normalizeSupplierDescription(
        product.supplierDescription
      );
      const descriptionOwner = supplierId
        ? snapshot.products.find(
            (item) =>
              item.supplierId === supplierId &&
              item.normalizedDescription === normalizedDescription
          )
        : null;

      if (
        descriptionOwner &&
        descriptionOwner.materialId !== existingMaterial?.id
      ) {
        return {
          ...base,
          action: "conflict" as const,
          note: "This supplier description already belongs to a different material.",
        };
      }

      if (!existingMaterial) {
        return {
          ...base,
          action: "create" as const,
          note: product.preferred
            ? "New preferred supplier product and opening approved price."
            : "New additional supplier product and opening approved price.",
        };
      }

      const existingProduct = snapshot.products.find(
        (item) =>
          item.materialId === existingMaterial.id &&
          item.supplierId === supplierId &&
          item.normalizedDescription === normalizedDescription
      );

      if (!existingProduct) {
        if (
          product.preferred &&
          snapshot.products.some(
            (item) => item.materialId === existingMaterial.id && item.isPreferred
          )
        ) {
          return {
            ...base,
            action: "conflict" as const,
            note: "This material already has a preferred supplier product.",
          };
        }

        return {
          ...base,
          action: "create" as const,
          note: "Existing material. This supplier product and opening price will be added.",
        };
      }

      const matchingPrice = snapshot.prices.find(
        (price) =>
          price.productId === existingProduct.id &&
          price.priceUnit === product.priceUnit &&
          pricesClose(price.price, product.price)
      );

      if (!matchingPrice) {
        return {
          ...base,
          action: "conflict" as const,
          note: "This supplier product already exists with a different price. No further price will be added.",
        };
      }

      return {
        ...base,
        action: "already_matched" as const,
        note: "Supplier product and opening price already match. Nothing will be written.",
      };
    });

    const productActions = products.map((product) => product.action);
    let action: ImportMaterialAction = "create";
    let note = "New material and supplier products.";

    if (productActions.some((item) => item === "invalid")) {
      action = "invalid";
      note = products
        .filter((product) => product.action === "invalid")
        .map((product) => product.note)
        .join(" ");
    } else if (productActions.some((item) => item === "conflict")) {
      action = "conflict";
      note = products
        .filter((product) => product.action === "conflict")
        .map((product) => product.note)
        .join(" ");
    } else if (!existingMaterial) {
      action = "create";
      note =
        products.length === 1
          ? "New material, supplier product, and opening approved price."
          : "New material with more than one supplier product.";
    } else if (productActions.every((item) => item === "already_matched")) {
      action = "already_matched";
      note =
        "Material, supplier products, and opening prices already match. Nothing will be written.";
    } else {
      action = "extend";
      note = "Existing material. Missing supplier products will be added.";
    }

    return {
      key: material.key,
      name: material.name,
      category: material.category,
      specification: formatMaterialSpecification(record),
      purchaseFormat: formatPurchaseFormat(record),
      purchaseUnit: material.purchaseUnit,
      widthMm: material.purchaseWidthMm,
      heightMm: material.purchaseHeightMm,
      lengthMm: material.purchaseLengthMm,
      inkVolumeLitres: material.inkVolumeLitres,
      action,
      note,
      existingMaterialId: existingMaterial?.id ?? null,
      products,
    };
  });

  const protectedMaterial =
    materialsByIdentity.get(PROTECTED_FOAMALITE_IDENTITY) ?? null;
  const preserved: Array<{ name: string; note: string }> = [];

  if (!protectedMaterial) {
    errors.push(
      "The existing Foamalite 5mm 3050 × 1560 record was not found. This import will not recreate it."
    );
  } else {
    const protectedProducts = snapshot.products.filter(
      (product) => product.materialId === protectedMaterial.id
    );
    const protectedPrices = snapshot.prices.filter((price) =>
      protectedProducts.some((product) => product.id === price.productId)
    );
    const priceNote = protectedPrices.some(
      (price) =>
        price.priceUnit === "sheet" &&
        pricesClose(price.price, PROTECTED_FOAMALITE.price)
    )
      ? `Left unchanged at about £${PROTECTED_FOAMALITE.price.toFixed(2)} per sheet.`
      : "Left unchanged. Its current price was not altered.";

    preserved.push({
      name: protectedMaterial.name,
      note: `Existing record. Dimensions stay 3050 × 1560. ${priceNote}`,
    });

    if (
      protectedPrices.length > 0 &&
      !protectedPrices.some(
        (price) =>
          price.priceUnit === "sheet" &&
          pricesClose(price.price, PROTECTED_FOAMALITE.price)
      )
    ) {
      warnings.push(
        "The live Foamalite price is not £41.75. This import will not change it."
      );
    }
  }

  for (const material of snapshot.materials) {
    if (
      material.identityKey !== PROTECTED_FOAMALITE_IDENTITY &&
      material.name.toLowerCase().includes("foamalite 5mm") &&
      material.name.toLowerCase().includes("3050")
    ) {
      warnings.push(
        `“${material.name}” is a different Foamalite 5mm record and will not be changed.`
      );
    }
  }

  for (const product of snapshot.products) {
    if (
      PROTECTED_SUPPLIER_DESCRIPTIONS.includes(product.normalizedDescription) &&
      product.materialId !== protectedMaterial?.id
    ) {
      warnings.push(
        `Protected description “${product.description}” is attached to a different material and will not be changed.`
      );
    }
  }

  const pq80 = normalizeSupplierDescription(
    PROTECTED_FOAMALITE.excludedDescription
  );
  const pq80Product = snapshot.products.find(
    (product) => product.normalizedDescription === pq80
  );

  preserved.push({
    name: PROTECTED_FOAMALITE.excludedDescription,
    note: pq80Product
      ? "The (PQ80) description already exists and will not be duplicated."
      : "The (PQ80) spreadsheet row is excluded. No second supplier product will be created.",
  });

  if (!snapshot.aliasesReady) {
    warnings.push(
      "Apply the supplier aliases migration before confirming. This preview has not written anything."
    );
  }

  const productPlans = materialPlans.flatMap((item) => item.products);
  const conflicts =
    supplierPlans.filter((item) => item.action === "conflict").length +
    aliasPlans.filter((item) => item.action === "conflict").length +
    materialPlans.filter(
      (item) => item.action === "conflict" || item.action === "invalid"
    ).length +
    errors.length;

  const materialsToCreate = materialPlans.filter(
    (item) => item.action === "create"
  ).length;
  const productsToCreate = productPlans.filter(
    (item) => item.action === "create"
  ).length;
  const aliasesToCreate = aliasPlans.filter(
    (item) => item.action === "create"
  ).length;
  const suppliersToCreate = supplierPlans.filter(
    (item) => item.action === "create"
  ).length;
  const writes = productsToCreate + aliasesToCreate + suppliersToCreate;

  let blockedReason: string | null = null;

  if (conflicts > 0) {
    blockedReason =
      "This preview has a conflict. Nothing will be imported until it is resolved.";
  } else if (!snapshot.aliasesReady) {
    blockedReason =
      "The supplier aliases migration is not available yet. Nothing will be imported.";
  } else if (writes === 0) {
    blockedReason =
      "Everything in the approved set already matches. Nothing will be imported.";
  }

  return {
    catalogVersion: source.catalogVersion,
    effectiveDate,
    canCommit: blockedReason == null,
    blockedReason,
    aliasesReady: snapshot.aliasesReady,
    suppliers: supplierPlans,
    aliases: aliasPlans,
    materials: materialPlans,
    preserved,
    skipped: source.skipped,
    counts: {
      suppliersToCreate,
      suppliersMatched: supplierPlans.filter((item) => item.action === "match")
        .length,
      aliasesToCreate,
      aliasesMatched: aliasPlans.filter((item) => item.action === "match")
        .length,
      materialsToCreate,
      productsToCreate,
      pricesToCreate: productsToCreate,
      alreadyMatched: productPlans.filter(
        (item) => item.action === "already_matched"
      ).length,
      conflicts,
    },
    warnings,
    errors,
  };
}

export function buildInitialImportPayload(
  plan: InitialImportPlan,
  effectiveDate: string
): InitialImportPayload | null {
  const expectedSuppliers =
    plan.catalogVersion === INITIAL_IMPORT_CATALOG_VERSION
      ? initialImportSupplierNames().length
      : plan.catalogVersion === MEDIUM_IMPORT_CATALOG_VERSION
        ? mediumImportSupplierNames().length
        : null;

  if (!plan.canCommit || expectedSuppliers == null) {
    return null;
  }

  const suppliers: InitialImportPayload["suppliers"] = [];

  for (const supplier of plan.suppliers) {
    if (supplier.action === "create") {
      suppliers.push({ action: "create", name: supplier.name });
    } else if (supplier.action === "match" && supplier.existingId) {
      suppliers.push({
        action: "match",
        name: supplier.name,
        expectedId: supplier.existingId,
      });
    }
  }

  if (suppliers.length !== expectedSuppliers) {
    return null;
  }

  return {
    catalogVersion: plan.catalogVersion,
    confirmation: INITIAL_IMPORT_CONFIRMATION,
    effectiveDate,
    suppliers,
    createAliases: plan.aliases
      .filter((alias) => alias.action === "create")
      .map((alias) => ({
        canonicalName: alias.canonicalName,
        alias: alias.alias,
      })),
    createMaterialKeys: plan.materials
      .filter((material) => material.action === "create")
      .map((material) => material.key),
    createProductKeys: plan.materials.flatMap((material) =>
      material.products
        .filter((product) => product.action === "create")
        .map((product) => product.key)
    ),
  };
}

export function isInitialImportConfirmation(value: unknown) {
  return value === INITIAL_IMPORT_CONFIRMATION;
}

export function resolveCatalogImportSource(
  catalogVersion: ApprovedImportCatalogVersion
): CatalogImportSource {
  if (catalogVersion === MEDIUM_IMPORT_CATALOG_VERSION) {
    return mediumImportSource();
  }

  return defaultInitialImportSource();
}
