import {
  buildMaterialIdentityKey,
  normalizeSupplierName,
} from "@/lib/materials/identity";
import type { MaterialCostingUnit } from "@/lib/materials/costing-unit";
import type { PurchaseUnit } from "@/lib/materials/units";

import { KNOWN_SUPPLIER_FAMILIES } from "@/lib/materials/supplier-aliases";

export const INITIAL_IMPORT_CATALOG_VERSION = "initial-approved-46";
export const INITIAL_IMPORT_CONFIRMATION = "IMPORT APPROVED MATERIALS";
export const INITIAL_IMPORT_SOURCE_TYPE = "initial_spreadsheet_import";
export const INITIAL_IMPORT_SOURCE_REFERENCE = "initial-approved-46";
export const INITIAL_IMPORT_PRICE_TOLERANCE = 0.02;

export const PROTECTED_FOAMALITE = {
  name: "Foamalite 5mm PVC 3050mm x 1560mm",
  thicknessMm: 5,
  colour: "White",
  finish: null,
  purchaseUnit: "sheet" as const,
  purchaseWidthMm: 3050,
  purchaseHeightMm: 1560,
  purchaseLengthMm: null,
  supplierName: "Pyramid Display Materials",
  supplierDescription: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
  excludedDescription:
    "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ80)",
  price: 41.75,
};

export const PROTECTED_FOAMALITE_IDENTITY = buildMaterialIdentityKey({
  name: PROTECTED_FOAMALITE.name,
  thicknessMm: PROTECTED_FOAMALITE.thicknessMm,
  colour: PROTECTED_FOAMALITE.colour,
  finish: PROTECTED_FOAMALITE.finish,
  purchaseUnit: PROTECTED_FOAMALITE.purchaseUnit,
  purchaseWidthMm: PROTECTED_FOAMALITE.purchaseWidthMm,
  purchaseHeightMm: PROTECTED_FOAMALITE.purchaseHeightMm,
  purchaseLengthMm: PROTECTED_FOAMALITE.purchaseLengthMm,
});

export const PROTECTED_SUPPLIER_DESCRIPTIONS = [
  PROTECTED_FOAMALITE.supplierDescription,
  PROTECTED_FOAMALITE.excludedDescription,
].map((description) => normalizeSupplierName(description));

export type InitialImportOffer = {
  key: string;
  supplierName: string;
  supplierDescription: string;
  price: number;
  priceUnit: PurchaseUnit;
  preferred: boolean;
  expectedCostPerSquareMetre: number | null;
  expectedCostPerLitre: number | null;
};

export type InitialImportMaterial = {
  key: string;
  name: string;
  category: string | null;
  thicknessMm: number | null;
  colour: string | null;
  finish: string | null;
  purchaseUnit: PurchaseUnit;
  purchaseWidthMm: number | null;
  purchaseHeightMm: number | null;
  purchaseLengthMm: number | null;
  /** Cartridge or container volume. Not part of the material identity. */
  inkVolumeLitres: number | null;
  /** Quote and internal cost basis, independent of purchase_unit. */
  costingUnit: MaterialCostingUnit;
  /** When purchase is a pack but quotes consume singles (e.g. blades). */
  costingPackQuantity?: number | null;
  products: readonly InitialImportOffer[];
};

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
): InitialImportOffer {
  const slug = normalizeSupplierName(supplierName)
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

function area(
  materialKey: string,
  supplierName: string,
  supplierDescription: string,
  price: number,
  priceUnit: PurchaseUnit,
  expectedCostPerSquareMetre: number,
  preferred = true
) {
  return offer(materialKey, supplierName, supplierDescription, price, priceUnit, {
    preferred,
    expectedCostPerSquareMetre,
  });
}

/**
 * Approved opening set. Sheet width and height follow the standard-name order,
 * matching the live Foamalite record, not the spreadsheet column order.
 * Roll length is stored in millimetres.
 * One material can have more than one supplier product. Pyramid stays preferred
 * where Pyramid and Antalis both sell the same sheet.
 * Prices are the latest reliable invoice prices, not the last spreadsheet row.
 */
export const INITIAL_IMPORT_MATERIALS: readonly InitialImportMaterial[] = [
  {
    key: "foamalite-3mm-3050x1560",
    name: "Foamalite 3mm PVC 3050mm x 1560mm",
    category: "Board",
    thicknessMm: 3,
    colour: "White",
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 3050,
    purchaseHeightMm: 1560,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "foamalite-3mm-3050x1560",
        "Pyramid Display Materials",
        "3mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ120)",
        25.47,
        "sheet",
        5.3530895334174025
      ),
      area(
        "foamalite-3mm-3050x1560",
        "Antalis",
        "Foamalite, XPRESS, Filmed, white 3.000mm 1560mm x 3050mm, 7301046",
        23.35,
        "sheet",
        4.907524169819252,
        false
      ),
    ],
  },
  {
    key: "foamalite-3mm-2440x1220",
    name: "Foamalite 3mm PVC 2440mm x 1220mm",
    category: "Board",
    thicknessMm: 3,
    colour: "White",
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 2440,
    purchaseHeightMm: 1220,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "foamalite-3mm-2440x1220",
        "Pyramid Display Materials",
        "3mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ200)",
        16.15,
        "sheet",
        5.425288900833109
      ),
      area(
        "foamalite-3mm-2440x1220",
        "Antalis",
        "Foamalite, XPRESS, Filmed, white 3.000mm 1220mm x 2440mm, 7301035",
        14.6,
        "sheet",
        4.904595538833647,
        false
      ),
    ],
  },
  {
    key: "correx-1524x3050-3-5mm",
    name: "Correx 1524mm x 3050mm 3.5mm",
    category: "Board",
    thicknessMm: 3.5,
    colour: "White",
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 1524,
    purchaseHeightMm: 3050,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "correx-1524x3050-3-5mm",
        "Pyramid Display Materials",
        "3.5m/600g 1524 x 3050mm(LF) White Correx Fluted PP (Untrimmed)",
        12.227,
        "sheet",
        2.630480616152489
      ),
    ],
  },
  {
    key: "correx-1220x2440-3-5mm",
    name: "Correx 1220mm x 2440mm 3.5mm",
    category: "Board",
    thicknessMm: 3.5,
    colour: "White",
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 1220,
    purchaseHeightMm: 2440,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "correx-1220x2440-3-5mm",
        "Pyramid Display Materials",
        "3.5m/600g 1220x2440mm (LF) White Correx Fluted PP (Untrimmed)",
        7.592,
        "sheet",
        2.550389680193496
      ),
    ],
  },
  {
    key: "correx-1524x3050-4mm",
    name: "Correx 1524mm x 3050mm 4mm",
    category: "Board",
    thicknessMm: 4,
    colour: "White",
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 1524,
    purchaseHeightMm: 3050,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "correx-1524x3050-4mm",
        "Antalis",
        "Correx®, White, matt, Long Flute, White 4.000mm 1524mm x 3050mm",
        11.21,
        "sheet",
        2.4116862441375155
      ),
    ],
  },
  {
    key: "swedboard-16mm-1600x3050",
    name: "Swedboard 16mm 1600mm x 3050mm",
    category: "Board",
    thicknessMm: 16,
    colour: null,
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 1600,
    purchaseHeightMm: 3050,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "swedboard-16mm-1600x3050",
        "Pyramid Display Materials",
        "16mm 1600 x 3050mm Swedboard Fibre Premium Structured Paper Board (PQ 65) FSC Mix Credit",
        57.309,
        "sheet",
        11.743647540983606
      ),
    ],
  },
  {
    key: "bubble-wrap-1500",
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
      area(
        "bubble-wrap-1500",
        "Pyramid Display Materials",
        "Bubble Wrap 1500mm x 100m Small",
        19.02,
        "roll",
        0.1268
      ),
    ],
  },
  {
    key: "perfectear-medium-1220",
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
      area(
        "perfectear-medium-1220",
        "Pyramid Display Materials",
        "1220mm x 91.4m PerfecTear Medium Application Tape (GXP 550P)",
        104.66,
        "roll",
        0.9385873659289018
      ),
    ],
  },
  {
    key: "kraft-brown-600-90gsm",
    name: "Kraft Brown Wrapping Paper 600mm 90gsm",
    category: "Consumable",
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: "roll",
    purchaseWidthMm: 600,
    purchaseHeightMm: null,
    purchaseLengthMm: 220000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "kraft-brown-600-90gsm",
        "Antalis",
        "Ribbed Kraft Paper, Master'in Access 90 g/m2, 600 mm x 220.00 m",
        25.23,
        "roll",
        0.19113636363636363
      ),
    ],
  },
  {
    key: "xanita-10mm-2440x1220",
    name: "Xanita 10mm White 2440mm x 1220mm",
    category: "Board",
    thicknessMm: 10,
    colour: "White",
    finish: "Matt",
    purchaseUnit: "sheet",
    purchaseWidthMm: 2440,
    purchaseHeightMm: 1220,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "xanita-10mm-2440x1220",
        "Antalis",
        "Xanita, Print, White, matt, 10.000mm 2440mm x 1220mm",
        26.94,
        "sheet",
        9.049986562751949
      ),
    ],
  },
  {
    key: "foamalite-5mm-2440x1220",
    name: "Foamalite 5mm PVC 2440mm x 1220mm",
    category: "Board",
    thicknessMm: 5,
    colour: "White",
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 2440,
    purchaseHeightMm: 1220,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "foamalite-5mm-2440x1220",
        "Pyramid Display Materials",
        "5mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ120)",
        25.99,
        "sheet",
        8.73085192152647
      ),
      area(
        "foamalite-5mm-2440x1220",
        "Antalis",
        "Foamalite, XPRESS, Filmed, white 5.000mm 1220mm x 2440mm",
        23.77,
        "sheet",
        7.985084654662725,
        false
      ),
    ],
  },
  {
    key: "dibond-sigwhite-3mm-1220x2440",
    name: "Dibond SigWhite Matt 3mm 1220mm x 2440mm",
    category: "Board",
    thicknessMm: 3,
    colour: "White",
    finish: "Matt",
    purchaseUnit: "sheet",
    purchaseWidthMm: 1220,
    purchaseHeightMm: 2440,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "dibond-sigwhite-3mm-1220x2440",
        "Pyramid Display Materials",
        "3mm 1220x2440mm SigWhite Matt/Primer (0.15) Easy Release (Digital) PQ 90 (FG-04399)",
        26.69,
        "sheet",
        8.966003762429455
      ),
    ],
  },
  {
    key: "dibond-eco-3mm-1500x3050",
    name: "Dibond SigWhite Eco 3mm 1500mm x 3050mm",
    category: "Board",
    thicknessMm: 3,
    colour: "White",
    finish: "Matt",
    purchaseUnit: "sheet",
    purchaseWidthMm: 1500,
    purchaseHeightMm: 3050,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "dibond-eco-3mm-1500x3050",
        "Pyramid Display Materials",
        "3mm 1500x3050mm SigWhite Eco DigMatt/Primer (0.15) Easy Release (Digital) PQ 60 (FG-04401)",
        41.15,
        "sheet",
        8.994535519125684
      ),
    ],
  },
  {
    key: "alupanel-mirror-3mm-1220x3050",
    name: "Alupanel Mirror Silver 3mm 1220mm x 3050mm",
    category: "Board",
    thicknessMm: 3,
    colour: "Silver",
    finish: "Mirror",
    purchaseUnit: "sheet",
    purchaseWidthMm: 1220,
    purchaseHeightMm: 3050,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "alupanel-mirror-3mm-1220x3050",
        "Pyramid Display Materials",
        "3mm 1220x3050mm Mirror Silver/Primer (FG-00169) Silver Mirror/Prime 0.3 skin PQ 70",
        113.54,
        "sheet",
        30.51330287557109
      ),
    ],
  },
  {
    key: "alupanel-brushed-3mm-2440x1220",
    name: "Alupanel Brushed Gold/Bronze 3mm 2440mm x 1220mm",
    category: "Board",
    thicknessMm: 3,
    colour: "Gold/Bronze",
    finish: "Brushed",
    purchaseUnit: "sheet",
    purchaseWidthMm: 2440,
    purchaseHeightMm: 1220,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "alupanel-brushed-3mm-2440x1220",
        "Pyramid Display Materials",
        "3mm 2440x1220mm Brushed Gold 0.3skin (FG-00149) Alupanel Brushed Bronze/Brushed Gold PQ 90",
        93.465,
        "sheet",
        31.39780972856759
      ),
    ],
  },
  {
    key: "coala-white-3mm-3050x1500",
    name: "Coala Printbond White 3mm 3050mm x 1500mm",
    category: "Board",
    thicknessMm: 3,
    colour: "White",
    finish: "Matt",
    purchaseUnit: "sheet",
    purchaseWidthMm: 3050,
    purchaseHeightMm: 1500,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "coala-white-3mm-3050x1500",
        "Antalis",
        "Coala, Printbond 208 Lite LX/LX, Latex matt/matt, metal, white, 3.000mm 3050mm x 1500mm",
        55.25,
        "sheet",
        12.076502732240439
      ),
    ],
  },
  {
    key: "coala-white-3mm-2440x1220",
    name: "Coala Printbond White 3mm 2440mm x 1220mm",
    category: "Board",
    thicknessMm: 3,
    colour: "White",
    finish: "Matt",
    purchaseUnit: "sheet",
    purchaseWidthMm: 2440,
    purchaseHeightMm: 1220,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "coala-white-3mm-2440x1220",
        "Antalis",
        "Coala, Printbond 208 Lite LX/LX, Latex matt/matt, metal, white, 3.000mm 2440mm x 1220mm",
        35.94,
        "sheet",
        12.07336737436173
      ),
    ],
  },
  {
    key: "coala-silver-3mm-1220x2440",
    name: "Coala Printbond Brushed Silver 3mm 1220mm x 2440mm",
    category: "Board",
    thicknessMm: 3,
    colour: "Silver",
    finish: "Brushed",
    purchaseUnit: "sheet",
    purchaseWidthMm: 1220,
    purchaseHeightMm: 2440,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "coala-silver-3mm-1220x2440",
        "Antalis",
        "Coala, Printbond 208 Lite, brushed silver, 3.000mm 1220mm x 2440mm",
        45.44,
        "sheet",
        15.2647137866165
      ),
    ],
  },
  {
    key: "swedboard-16mm-1600x3200",
    name: "Swedboard 16mm 1600mm x 3200mm Premium",
    category: "Board",
    thicknessMm: 16,
    colour: null,
    finish: null,
    purchaseUnit: "sheet",
    purchaseWidthMm: 1600,
    purchaseHeightMm: 3200,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "swedboard-16mm-1600x3200",
        "Pyramid Display Materials",
        "16mm 1600 x 3200mm Swedboard Fibre Premium Structured Paper Board (PQ 65) FSC Mix Credit",
        58.968,
        "sheet",
        11.517187499999999
      ),
    ],
  },
  {
    key: "swedboard-16mm-1600x3200-fr",
    name: "Swedboard 16mm 1600mm x 3200mm FR",
    category: "Board",
    thicknessMm: 16,
    colour: null,
    finish: "FR",
    purchaseUnit: "sheet",
    purchaseWidthMm: 1600,
    purchaseHeightMm: 3200,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "swedboard-16mm-1600x3200-fr",
        "Pyramid Display Materials",
        "16mm 1600 x 3200mm Swedboard Fibre FR Structured FR Board (PQ 65) FSC Mix Credit",
        88.07,
        "sheet",
        17.201171874999996
      ),
    ],
  },
  {
    key: "hips-1mm-2440x1220",
    name: "HIPS 1mm White 2440mm x 1220mm",
    category: "Board",
    thicknessMm: 1,
    colour: "White",
    finish: "Gloss/matt",
    purchaseUnit: "sheet",
    purchaseWidthMm: 2440,
    purchaseHeightMm: 1220,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "hips-1mm-2440x1220",
        "PPB",
        "WHITE 7231 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 2440mm x 1220mm",
        26,
        "sheet",
        8.734211233539371
      ),
      {
        key: "hips-1mm-2440x1220--ppb-ps1275-p91",
        supplierName: "PPB",
        supplierDescription:
          "WHITE PS1275 P91 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 2440mm x 1220mm",
        price: 26,
        priceUnit: "sheet",
        preferred: false,
        expectedCostPerSquareMetre: 8.734211233539371,
        expectedCostPerLitre: null,
      },
    ],
  },
  {
    key: "briteline-greyback-1370x50",
    name: "Briteline Greyback Removable 1370mm x 50m",
    category: "Vinyl",
    thicknessMm: null,
    colour: "White",
    finish: "Matt",
    purchaseUnit: "roll",
    purchaseWidthMm: 1370,
    purchaseHeightMm: null,
    purchaseLengthMm: 50000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "briteline-greyback-1370x50",
        "Pyramid Display Materials",
        "Briteline MT WHT GB Removable 1370mm x 50m Monomeric Vinyl - Grey Adhesive (BLMVMWRG1370)",
        89.11,
        "roll",
        1.3008759124087592
      ),
    ],
  },
  {
    key: "su3-70-1350x50",
    name: "SU3-70 Semi-matt UV Laminate 1350mm x 50m",
    category: "Laminate",
    thicknessMm: null,
    colour: null,
    finish: "Semi-matt",
    purchaseUnit: "roll",
    purchaseWidthMm: 1350,
    purchaseHeightMm: null,
    purchaseLengthMm: 50000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "su3-70-1350x50",
        "All Print Supplies",
        "SU3-70 SEMI-MATT UV SEAL 50M X 1350MM",
        127.21,
        "roll",
        1.8845925925925926
      ),
    ],
  },
  {
    key: "simply-rollup-1067x50",
    name: "Simply Roll Up 300 Greyback 1067mm x 50m",
    category: "Vinyl",
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: "roll",
    purchaseWidthMm: 1067,
    purchaseHeightMm: null,
    purchaseLengthMm: 50000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "simply-rollup-1067x50",
        "Pyramid Display Materials",
        "Simply Roll Up 300 GB 1067mm x 50m Grey Back Textured PVC Film",
        178.2,
        "roll",
        3.3402061855670104
      ),
    ],
  },
  {
    key: "simply-drywipe-1300x100",
    name: "Simply Gloss Dry-wipe Laminate 1300mm x 100m",
    category: "Laminate",
    thicknessMm: null,
    colour: null,
    finish: "Gloss",
    purchaseUnit: "roll",
    purchaseWidthMm: 1300,
    purchaseHeightMm: null,
    purchaseLengthMm: 100000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "simply-drywipe-1300x100",
        "Pyramid Display Materials",
        "Simply Gloss Dry Wipe Lam UV 1300mm x 100m Gloss OPP Laminate 50 micron FF",
        238.91,
        "roll",
        1.8377692307692308
      ),
    ],
  },
  {
    key: "supreme-banner-1600x30",
    name: "Supreme Banner FR 450g 1600mm x 30m",
    category: "Banner",
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: "roll",
    purchaseWidthMm: 1600,
    purchaseHeightMm: null,
    purchaseLengthMm: 30000,
    inkVolumeLitres: null,
    costingUnit: "square_metre",
    products: [
      area(
        "supreme-banner-1600x30",
        "Pyramid Display Materials",
        "Supreme Banner FR 450g 1600mm x 30mtr (PRO) Frontlit1000x1000 18 x 18 [Hard tube Packed]",
        135.91,
        "roll",
        2.8314583333333334
      ),
    ],
  },
  ink("hp-730-photo-black-300", "HP 730 Photo Black 300ml", "Photo black", 0.3, "HP 730 Ink Cartridge Photo Black - 300ml", "Papergraphics", 130),
  ink("hp-730-matte-black-300", "HP 730 Matte Black 300ml", "Matte black", 0.3, "HP 730 Ink Cartridge Matte Black - 300ml", "Papergraphics", 130),
  ink("hp-730-grey-300", "HP 730 Grey 300ml", "Grey", 0.3, "HP 730 Ink Cartridge Grey - 300ml", "Papergraphics", 130),
  ink("hp-832-cyan-1000", "HP 832 Cyan 1000ml", "Cyan", 1, "HP/4UV76A No. 832 Latex Cyan Ink Cartridge 1000ml", "Papergraphics", 95),
  ink("hp-832-magenta-1000", "HP 832 Magenta 1000ml", "Magenta", 1, "HP/4UV77A No. 832 Latex Magenta Ink 1000ml", "Papergraphics", 95),
  ink("hp-832-black-1000", "HP 832 Black 1000ml", "Black", 1, "HP/4UV75A No. 832 Latex Black Ink 1000ml", "Papergraphics", 95),
  ink("hp-832-yellow-1000", "HP 832 Yellow 1000ml", "Yellow", 1, "HP/4UV78A No. 832 Latex Yellow Ink 1000ml", "Papergraphics", 95),
  ink("hp-832-optimiser-1000", "HP 832 Optimiser 1000ml", "Optimiser", 1, "HP/4UV81A No. 832 Latex Optimiser Ink 1000ml", "Papergraphics", 95),
  ink("hp-882-magenta-5000", "HP 882 Magenta 5000ml", "Magenta", 5, "HP No. 882 Latex Ink Cartridge Magenta - 5000ml", "Perfect Colours", 331.34),
  ink("hp-882-yellow-5000", "HP 882 Yellow 5000ml", "Yellow", 5, "HP No. 882 Latex Ink Cartridge Yellow - 5000ml", "Perfect Colours", 335.74),
  ink("hp-882-optimizer-5000", "HP 882 Optimizer 5000ml", null, 5, "HP No. 882 Latex Optimizer Ink Cartridge - 5000ml", "Perfect Colours", 335.74),
  ink("hp-882-overcoat-5000", "HP 882 Overcoat 5000ml", null, 5, "HP No. 882 Latex Overcoat Ink Cartridge - 5000ml", "Perfect Colours", 331.34),
  ink("hp-886-white-3000", "HP 886 White 3000ml", "White", 3, "HP No. 886 Latex Ink Cartridge White - 3000ml", "Perfect Colours", 253.25),
  unitItem(
    "hp-latex-printhead-cleaning-kit",
    "HP Latex Printhead Cleaning Kit",
    "Consumable",
    null,
    "Perfect Colours",
    "HP Latex Printhead Cleaning Kit",
    237.89,
    "unit"
  ),
  unitItem(
    "showcard-strut-240",
    "Showcard Strut Taped White 240mm",
    "Consumable",
    "White",
    "Antalis",
    "Showcard, Struts, Taped, White, 240mm",
    0.38,
    "unit"
  ),
  unitItem(
    "showcard-strut-190",
    "Showcard Strut Taped White 190mm",
    "Consumable",
    "White",
    "Antalis",
    "Showcard, Struts, Taped, White, 190mm",
    0.36,
    "unit"
  ),
  unitItem(
    "showcard-strut-140",
    "Showcard Strut Taped White 140mm",
    "Consumable",
    "White",
    "Antalis",
    "Showcard, Struts, Taped, White, 140mm",
    0.34,
    "unit"
  ),
  unitItem(
    "tangential-knife-36-pack",
    "Standard Tangential Knife 36°",
    "Consumable",
    null,
    "Perfect Colours",
    "STANDARD TANGENTIAL KNIFE 36' (Pack of 5)",
    173.4,
    "pack",
    { costingPackQuantity: 5 }
  ),
  unitItem(
    "heavy-duty-cutout-knife",
    "Heavy Duty Cutout Knife",
    "Consumable",
    null,
    "Perfect Colours",
    "HEAVY DUTY CUTOUT KNIFE",
    80,
    "unit"
  ),
  {
    key: "orabond-1395-12x50",
    name: "Orabond 1395 Tape 12mm x 50m",
    category: "Consumable",
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: "unit",
    purchaseWidthMm: 12,
    purchaseHeightMm: null,
    purchaseLengthMm: 50000,
    inkVolumeLitres: null,
    costingUnit: "each",
    products: [
      offer(
        "orabond-1395-12x50",
        "Antalis",
        "Orabond, 1395, transparent, 130µm acrylic solvent 12mm x 50.00m, pack of 20 rolls",
        3.31,
        "unit"
      ),
    ],
  },
];

function ink(
  key: string,
  name: string,
  colour: string | null,
  volumeLitres: number,
  description: string,
  supplierName: string,
  price: number
): InitialImportMaterial {
  return {
    key,
    name,
    category: "Ink",
    thicknessMm: null,
    colour,
    finish: null,
    purchaseUnit: "unit",
    purchaseWidthMm: null,
    purchaseHeightMm: null,
    purchaseLengthMm: null,
    inkVolumeLitres: volumeLitres,
    costingUnit: "litre",
    products: [
      offer(key, supplierName, description, price, "unit", {
        expectedCostPerLitre: price / volumeLitres,
      }),
    ],
  };
}

function unitItem(
  key: string,
  name: string,
  category: string,
  colour: string | null,
  supplierName: string,
  description: string,
  price: number,
  purchaseUnit: Extract<PurchaseUnit, "unit" | "pack">,
  options: { costingPackQuantity?: number } = {}
): InitialImportMaterial {
  return {
    key,
    name,
    category,
    thicknessMm: null,
    colour,
    finish: null,
    purchaseUnit,
    purchaseWidthMm: null,
    purchaseHeightMm: null,
    purchaseLengthMm: null,
    inkVolumeLitres: null,
    costingUnit: purchaseUnit === "pack" && options.costingPackQuantity ? "each" : "each",
    costingPackQuantity: options.costingPackQuantity ?? null,
    products: [offer(key, supplierName, description, price, purchaseUnit)],
  };
}

export function initialImportIdentity(material: InitialImportMaterial) {
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

export function initialImportSupplierNames() {
  return [
    ...new Set(
      INITIAL_IMPORT_MATERIALS.flatMap((material) =>
        material.products.map((product) => product.supplierName)
      )
    ),
  ];
}

export function initialImportAliases() {
  const supplierNames = new Set(initialImportSupplierNames());

  return KNOWN_SUPPLIER_FAMILIES.filter((family) =>
    supplierNames.has(family.canonicalName)
  ).flatMap((family) =>
    family.aliases.map((alias) => ({
      canonicalName: family.canonicalName,
      alias,
    }))
  );
}

export function deferredSupplierAliases() {
  const supplierNames = new Set(initialImportSupplierNames());

  return KNOWN_SUPPLIER_FAMILIES.filter(
    (family) => !supplierNames.has(family.canonicalName)
  ).flatMap((family) =>
    family.aliases.map((alias) => ({
      canonicalName: family.canonicalName,
      alias,
    }))
  );
}

export function initialImportSqlCatalog() {
  return INITIAL_IMPORT_MATERIALS.map((material) => ({
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
      price: sqlNumber(product.price),
      priceUnit: product.priceUnit,
      preferred: product.preferred,
    })),
  }));
}

function sqlNumber(price: number) {
  return price.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
