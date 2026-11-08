import { buildMaterialIdentityKey } from "@/lib/materials/identity";
import type { CatalogImportSource } from "@/lib/materials/initial-import-plan";
import type { InitialImportMaterial } from "@/lib/materials/initial-import-catalog";
import { calculateCostPerSquareMetre } from "@/lib/materials/pricing";
import { KNOWN_SUPPLIER_FAMILIES } from "@/lib/materials/supplier-aliases";
import type { MaterialCostingUnit } from "@/lib/materials/costing-unit";
import type { PurchaseUnit } from "@/lib/materials/units";

export const MEDIUM_IMPORT_CATALOG_VERSION = "medium-approved-batch-2";

const BUBBLE_WRAP_KEY = "bubble-wrap-1500";
const PERFECTEAR_KEY = "perfectear-medium-1220";

export const MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS = [
  BUBBLE_WRAP_KEY,
  PERFECTEAR_KEY,
] as const;

type Offer = InitialImportMaterial["products"][number];

function offer(
  materialKey: string,
  supplierName: string,
  supplierDescription: string,
  price: number,
  priceUnit: PurchaseUnit,
  options: {
    preferred?: boolean;
    expectedCostPerSquareMetre?: number | null;
    expectedCostPerLitre?: number | null;
  } = {}
): Offer {
  const slug = supplierName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    key: `${materialKey}--${slug}`,
    supplierName,
    supplierDescription,
    price,
    priceUnit,
    preferred: options.preferred ?? true,
    expectedCostPerSquareMetre: options.expectedCostPerSquareMetre ?? null,
    expectedCostPerLitre: options.expectedCostPerLitre ?? null,
  };
}

function withArea(
  materialKey: string,
  supplierName: string,
  supplierDescription: string,
  price: number,
  priceUnit: PurchaseUnit,
  dimensions: {
    widthMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
  },
  preferred = true
) {
  const expectedCostPerSquareMetre = calculateCostPerSquareMetre({
    price,
    priceUnit,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
    lengthMm: dimensions.lengthMm,
  });

  if (expectedCostPerSquareMetre == null) {
    throw new Error(`No £/m² for ${materialKey}`);
  }

  return offer(
    materialKey,
    supplierName,
    supplierDescription,
    price,
    priceUnit,
    { preferred, expectedCostPerSquareMetre }
  );
}

function sheetMaterial(
  key: string,
  name: string,
  category: string,
  colour: string | null,
  finish: string | null,
  widthMm: number,
  heightMm: number,
  supplierName: string,
  supplierDescription: string,
  price: number,
  thicknessMm: number | null = null,
  costingUnit: MaterialCostingUnit = "sheet",
  costingPackQuantity: number | null = null
): InitialImportMaterial {
  return {
    key,
    name,
    category,
    thicknessMm,
    colour,
    finish,
    purchaseUnit: "sheet",
    purchaseWidthMm: widthMm,
    purchaseHeightMm: heightMm,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit,
    costingPackQuantity,
    products: [
      withArea(
        key,
        supplierName,
        supplierDescription,
        price,
        "sheet",
        { widthMm, heightMm, lengthMm: null }
      ),
    ],
  };
}

function rollMaterial(
  key: string,
  name: string,
  category: string,
  colour: string | null,
  finish: string | null,
  widthMm: number,
  lengthMm: number,
  supplierName: string,
  supplierDescription: string,
  price: number
): InitialImportMaterial {
  return {
    key,
    name,
    category,
    thicknessMm: null,
    colour,
    finish,
    purchaseUnit: "roll",
    purchaseWidthMm: widthMm,
    purchaseHeightMm: null,
    purchaseLengthMm: lengthMm,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      withArea(
        key,
        supplierName,
        supplierDescription,
        price,
        "roll",
        { widthMm, heightMm: null, lengthMm }
      ),
    ],
  };
}

function metreMaterial(
  key: string,
  name: string,
  category: string,
  colour: string | null,
  finish: string | null,
  widthMm: number,
  supplierName: string,
  supplierDescription: string,
  price: number
): InitialImportMaterial {
  return {
    key,
    name,
    category,
    thicknessMm: null,
    colour,
    finish,
    purchaseUnit: "linear_metre",
    purchaseWidthMm: widthMm,
    purchaseHeightMm: null,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      withArea(
        key,
        supplierName,
        supplierDescription,
        price,
        "linear_metre",
        { widthMm, heightMm: null, lengthMm: null }
      ),
    ],
  };
}

function unitMaterial(
  key: string,
  name: string,
  category: string,
  colour: string | null,
  supplierName: string,
  supplierDescription: string,
  price: number
): InitialImportMaterial {
  return {
    key,
    name,
    category,
    thicknessMm: null,
    colour,
    finish: null,
    purchaseUnit: "unit",
    purchaseWidthMm: null,
    purchaseHeightMm: null,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "each",
    products: [offer(key, supplierName, supplierDescription, price, "unit")],
  };
}

/**
 * Second approved batch. Prices are the invoice each/sheet/roll/metre figures.
 * Pack quantities stay in the supplier description.
 * Bubble Wrap and PerfecTear already exist. Their new products are not preferred.
 */
export const MEDIUM_IMPORT_MATERIALS: readonly InitialImportMaterial[] = [
  {
    key: BUBBLE_WRAP_KEY,
    name: "Bubble Wrap 1500mm",
    category: "Consumable",
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: "roll",
    purchaseWidthMm: 1500,
    purchaseHeightMm: null,
    purchaseLengthMm: 100000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      withArea(
        BUBBLE_WRAP_KEY,
        "Pyramid Display Materials",
        "Bubble Wrap 1500mm x 100m Small",
        19.02,
        "roll",
        { widthMm: 1500, heightMm: null, lengthMm: 100000 }
      ),
      withArea(
        BUBBLE_WRAP_KEY,
        "Antalis",
        "Air Bubble Film, Jiffy Small Bubble Wrap 1500 mm x 100.00 m, 1 ply, Clear, 1 reel",
        33.29,
        "roll",
        { widthMm: 1500, heightMm: null, lengthMm: 100000 },
        false
      ),
    ],
  },
  {
    key: PERFECTEAR_KEY,
    name: "PerfecTear Medium Application Tape 1220mm",
    category: "Consumable",
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: "roll",
    purchaseWidthMm: 1220,
    purchaseHeightMm: null,
    purchaseLengthMm: 91400,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      withArea(
        PERFECTEAR_KEY,
        "Pyramid Display Materials",
        "1220mm x 91.4m PerfecTear Medium Application Tape (GXP 550P)",
        104.66,
        "roll",
        { widthMm: 1220, heightMm: null, lengthMm: 91400 }
      ),
      withArea(
        PERFECTEAR_KEY,
        "All Print Supplies",
        "KLEENTEAR 50 MEDIUM 100YDS X 1220MM",
        104.78,
        "roll",
        { widthMm: 1220, heightMm: null, lengthMm: 91400 },
        false
      ),
    ],
  },
  sheetMaterial(
    "edixion-offset-350-sra3",
    "Edixion Offset 350gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Short grain",
    450,
    320,
    "Antalis",
    "Edixion, Offset, white, 350g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
    0.08254,
    null,
    "sheet",
    125
  ),
  sheetMaterial(
    "edixion-offset-300-sra3",
    "Edixion Offset 300gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Short grain",
    450,
    320,
    "Antalis",
    "Edixion, Offset, white, 300g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
    0.06983,
    null,
    "sheet",
    125
  ),
  sheetMaterial(
    "edixion-offset-250-sra3",
    "Edixion Offset 250gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Short grain",
    450,
    320,
    "Antalis",
    "Edixion, Offset, white, woodfree ECF 250g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
    0.05817,
    null,
    "sheet",
    125
  ),
  sheetMaterial(
    "edixion-offset-170-sra3",
    "Edixion Offset 170gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Short grain",
    450,
    320,
    "Antalis",
    "Edixion, Offset, white, 170g/m2, 450mm x 320mm, SRA3, short grain, pack of 250 sheets, FSC Mix Credit",
    0.03826,
    null,
    "sheet",
    250
  ),
  sheetMaterial(
    "novatec-silk-350-sra3",
    "Novatec Silk 350gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Silk",
    450,
    320,
    "Antalis",
    "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 350g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
    0.08919,
    null,
    "sheet",
    125
  ),
  sheetMaterial(
    "novatec-silk-300-sra3",
    "Novatec Silk 300gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Silk",
    450,
    320,
    "Antalis",
    "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 300g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
    0.07548,
    null,
    "sheet",
    125
  ),
  sheetMaterial(
    "novatec-silk-250-sra3",
    "Novatec Silk 250gsm SRA3 450mm x 320mm",
    "Paper",
    "White",
    "Silk",
    450,
    320,
    "Antalis",
    "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 250g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
    0.06212,
    null,
    "sheet",
    125
  ),
  sheetMaterial(
    "novatec-silk-170-sra3",
    "Novatec Silk 170gsm SRA3 320mm x 450mm",
    "Paper",
    "White",
    "Silk",
    320,
    450,
    "Antalis",
    "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 170g/m2 320mm x 450mm, SRA3, long grain pack of 250 sheets, FSC Mix Credit",
    0.04132,
    null,
    "sheet",
    250
  ),
  sheetMaterial(
    "emblem-greyboard-300-450x640",
    "Emblem Greyboard 300gsm 450mm x 640mm",
    "Paper",
    "Grey",
    "Long grain",
    450,
    640,
    "Antalis",
    "EMBLEM, Greyboard, Grey, 100% recycled 300g/m2, 480µm 450mm x 640mm, long grain Bundle of 265 Sheets, FSC Recycled 100% Pallet of 18 Bundles",
    0.12854,
    0.48,
    "sheet",
    265
  ),
  unitMaterial(
    "stationery-box-a4-brown",
    "Stationery Box A4 Brown",
    "Packaging",
    "Brown",
    "Antalis",
    "Stationery box, With Lid A4, brown 305mm x 216mm x 57mm, Pack of 50",
    0.30769
  ),
  unitMaterial(
    "stationery-box-a4-white",
    "Stationery Box A4 White",
    "Packaging",
    "White",
    "Antalis",
    "Stationery box, With Lid A4, white 305mm x 216mm x 57mm, Pack of 50 1 Ream",
    0.3384
  ),
  unitMaterial(
    "stationery-box-a5-brown",
    "Stationery Box A5 Brown",
    "Packaging",
    "Brown",
    "Antalis",
    "Stationery Box Brown A5 ream boxes and lids Inner dim. 215 x 156 x 57mm 600 micron solidboard pack of 100",
    0.84
  ),
  unitMaterial(
    "c4-manilla-envelope",
    "C4 Manilla Board Back Envelope",
    "Packaging",
    "Manilla",
    "Antalis",
    "River series, Pocket, C4, 229 x 324 mm Manilla, Board back envelope, Superseal with adhesive flap, 120g/m2 box of 125 pieces",
    0.149
  ),
  sheetMaterial(
    "e-flute-short-1067x1575",
    "E-flute White 1067mm x 1575mm Short Flute",
    "Board",
    "White",
    "Short flute",
    1067,
    1575,
    "Pyramid Display Materials",
    "E Flute 190Y/180W 1067x1575mm (Short Flute) Corrugated Board (PQ 700) 'FSC Mix Credit",
    2.741,
    null,
    "square_metre"
  ),
  sheetMaterial(
    "e-flute-long-1575x1065",
    "E-flute White 1575mm x 1065mm Long Flute",
    "Board",
    "White",
    "Long flute",
    1575,
    1065,
    "Antalis",
    "Corrugated Board, E - Flute, white 190Y/180W, Long Flute, 504g/m2, 1700µm 1575mm x 1065mm, FSC Mix Credit",
    3.65,
    1.7,
    "square_metre"
  ),
  rollMaterial(
    "nucoat-m16-permanent-1370x50",
    "Nucoat M16 Permanent White 1370mm x 50m",
    "Vinyl",
    "White",
    "Matt permanent",
    1370,
    50000,
    "All Print Supplies",
    "M16-P-P MT WH HOP PERM PE 50 X 1370",
    129.85
  ),
  rollMaterial(
    "nucoat-m16-high-tack-1370x50",
    "Nucoat M16 High Tack White 1370mm x 50m",
    "Vinyl",
    "White",
    "Matt high tack",
    1370,
    50000,
    "All Print Supplies",
    "M16-H-P MT WH HIGH PE 50 X 1370",
    266.18
  ),
  rollMaterial(
    "gu3-70-gloss-1350x50",
    "GU3-70 Gloss UV Laminate 1350mm x 50m",
    "Laminate",
    null,
    "Gloss",
    1350,
    50000,
    "All Print Supplies",
    "GU3-70 ULTRA GLOSS UV SEAL 50M X 1350MM",
    139.68
  ),
  rollMaterial(
    "m73-floor-1370x50",
    "M73 Matt R10 Floor Vinyl 1370mm x 50m",
    "Vinyl",
    null,
    "Matt",
    1370,
    50000,
    "All Print Supplies",
    "M73-P FL00R10 MATT R10 50 X 1370",
    199.65
  ),
  metreMaterial(
    "black-matt-permanent-1230",
    "Permanent Black Matt Vinyl 1230mm",
    "Vinyl",
    "Black",
    "Matt",
    1230,
    "All Print Supplies",
    "MT BLACK PERM 1230MM",
    4.05
  ),
  metreMaterial(
    "dol-1480-matt-1370",
    "Avery DOL 1480 Matt Cast Laminate 1370mm",
    "Laminate",
    null,
    "Matt",
    1370,
    "All Print Supplies",
    "DOL1480 Z MATT CAST LAM 1370MM",
    9.45
  ),
  metreMaterial(
    "mpi-1104-gloss-1370",
    "Avery MPI 1104 Gloss Cast Vinyl 1370mm",
    "Vinyl",
    "White",
    "Gloss",
    1370,
    "All Print Supplies",
    "MPI1104EA WHITE GLOSS CAST 1370MM",
    9.63
  ),
  {
    key: "hp-882-black-5000",
    name: "HP 882 Black 5000ml",
    category: "Ink",
    thicknessMm: null,
    colour: "Black",
    finish: null,
    purchaseUnit: "unit",
    purchaseWidthMm: null,
    purchaseHeightMm: null,
    purchaseLengthMm: null,
    inkVolumeLitres: 5,
    costingUnit: "litre",
    products: [
      offer(
        "hp-882-black-5000",
        "Perfect Colours",
        "HP No. 882 Latex Ink Cartridge Black - 5000ml",
        335.74,
        "unit",
        { expectedCostPerLitre: 335.74 / 5 }
      ),
    ],
  },
  rollMaterial(
    "inkjet-90gsm-841x90",
    "Colour Inkjet Paper 90gsm 841mm x 90m",
    "Paper",
    "White",
    null,
    841,
    90000,
    "Perfect Colours",
    "Colour Inkjet Paper - 33.1in 841mm x 90m - 90gsm",
    24.49
  ),
  rollMaterial(
    "inkjet-90gsm-841x91",
    "Colour Inkjet Paper 90gsm 841mm x 91m",
    "Paper",
    "White",
    null,
    841,
    91000,
    "Perfect Colours",
    "Inkjet Paper 90gsm 841mm x 91m",
    22.15
  ),
  rollMaterial(
    "su3-70-1560x50",
    "SU3-70 Semi-matt UV Laminate 1560mm x 50m",
    "Laminate",
    null,
    "Semi-matt",
    1560,
    50000,
    "All Print Supplies",
    "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM",
    141.39
  ),
  rollMaterial(
    "ww300-matt-1371x50",
    "WW300 Matt White 1371mm x 50m",
    "Vinyl",
    "White",
    "Matt",
    1371,
    50000,
    "Pyramid Display Materials",
    "WW300 MATT WHITE 50M X 1371MM",
    298.62
  ),
  rollMaterial(
    "easydot-matt-1372x50",
    "Easydot Matt White 1372mm x 50m",
    "Vinyl",
    "White",
    "Matt",
    1372,
    50000,
    "All Print Supplies",
    "SOLVOPRINT DOT MATT WHITE 50 X 1372",
    194.16
  ),
  rollMaterial(
    "ww100-gloss-1371x50",
    "WW100 Pro Gloss White 1371mm x 50m",
    "Vinyl",
    "White",
    "Gloss",
    1371,
    50000,
    "All Print Supplies",
    "WW100 PRO GLOSS WHITE 50M X 1371MM",
    706.55
  ),
  rollMaterial(
    "lf10700-cast-matt-1370x50",
    "LF10700 Cast Matt UV Laminate 1370mm x 50m",
    "Laminate",
    null,
    "Matt",
    1370,
    50000,
    "All Print Supplies",
    "LF10700 CM-UV CAST MT LAM 50 X 1370",
    497.18
  ),
  metreMaterial(
    "p65w-silver-crystal-1600",
    "P65W Silver Crystal 1600mm",
    "Vinyl",
    "Silver",
    null,
    1600,
    "All Print Supplies",
    "P65W SILVER CRYSTAL 1600MM",
    11.19
  ),
  rollMaterial(
    "conform-4075-1220",
    "Conform 4075 Application Tape 1220mm",
    "Consumable",
    null,
    null,
    1220,
    91440,
    "All Print Supplies",
    "4075 CONFORM 100YDS X 1220MM",
    111.5
  ),
  sheetMaterial(
    "hips-1mm-3050x1524",
    "HIPS 1mm White 3050mm x 1524mm",
    "Board",
    "White",
    "Gloss/matt",
    3050,
    1524,
    "PPB",
    "WHITE 7231 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 3050mm x 1524mm",
    30,
    1,
    "square_metre"
  ),
];

export const MEDIUM_IMPORT_EXCLUDED = [
  {
    label: "High tack black matt vinyl 1230mm",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "Dual Grey 5i solar film 1524mm x 5m",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "Auto Vision Black 05 1524mm x 5m",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "BW009 Mid Antique Oak 1220mm",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "ML67 Bianco Carrara 1220mm",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "Self-adhesive magnetic paper 1000mm x 15m",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "Ferrous paper 1270mm x 50m",
    reason: "Supplier is still unresolved.",
  },
  {
    label: "Blackback fabric 2.5m x 91m",
    reason: "Supplier is still unresolved. APS is not mapped to All Print Supplies.",
  },
  {
    label: "Lumex A APET gloss clear 5mm and 3mm",
    reason: "Sheet size is still unknown.",
  },
  {
    label: "Expanse 420g greyback banner",
    reason: "Width is still unknown.",
  },
  {
    label: "Digiflor tactile flooring",
    reason: "Size is still unknown.",
  },
  {
    label: "Novatec Digital silk unsized line",
    reason: "The unsized invoice line cannot be assigned to one gsm.",
  },
  {
    label: "Blackback fabric 3.2m x 60m slit to 2.5m",
    reason: "This is a conversion, not a stocked 2.5m roll.",
  },
] as const;

export function mediumImportIdentity(material: InitialImportMaterial) {
  return buildMaterialIdentityKey({
    name: material.name,
    thicknessMm: material.thicknessMm,
    colour: material.colour,
    finish: material.finish,
    purchaseUnit: material.purchaseUnit,
    purchaseWidthMm: material.purchaseWidthMm,
    purchaseHeightMm: material.purchaseHeightMm,
    purchaseLengthMm: material.purchaseLengthMm,
  });
}

export function mediumImportSupplierNames() {
  return [
    ...new Set(
      MEDIUM_IMPORT_MATERIALS.flatMap((material) =>
        material.products.map((product) => product.supplierName)
      )
    ),
  ];
}

export function mediumImportAliases() {
  const supplierNames = new Set(mediumImportSupplierNames());

  return KNOWN_SUPPLIER_FAMILIES.filter((family) =>
    supplierNames.has(family.canonicalName)
  ).flatMap((family) =>
    family.aliases.map((alias) => ({
      canonicalName: family.canonicalName,
      alias,
    }))
  );
}

function sqlPrice(price: number) {
  const text = price.toString();

  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Price is not a plain decimal: ${price}`);
  }

  return text;
}

export function mediumImportSqlCatalog() {
  return MEDIUM_IMPORT_MATERIALS.map((material) => ({
    key: material.key,
    name: material.name,
    category: material.category,
    thicknessMm: material.thicknessMm,
    colour: material.colour,
    finish: material.finish,
    purchaseUnit: material.purchaseUnit,
    widthMm: material.purchaseWidthMm,
    heightMm: material.purchaseHeightMm,
    lengthMm: material.purchaseLengthMm,
    inkVolumeLitres: material.inkVolumeLitres,
    costingUnit: material.costingUnit,
    costingPackQuantity: material.costingPackQuantity ?? null,
    products: material.products.map((product) => ({
      key: product.key,
      supplierName: product.supplierName,
      description: product.supplierDescription,
      price: sqlPrice(product.price),
      priceUnit: product.priceUnit,
      preferred: product.preferred,
    })),
  }));
}

export function mediumImportSource(): CatalogImportSource {
  return {
    catalogVersion: MEDIUM_IMPORT_CATALOG_VERSION,
    materials: MEDIUM_IMPORT_MATERIALS,
    supplierNames: mediumImportSupplierNames(),
    aliases: mediumImportAliases(),
    deferredAliases: [],
    skipped: MEDIUM_IMPORT_EXCLUDED.map((item) => ({
      label: item.label,
      reason: item.reason,
    })),
  };
}
