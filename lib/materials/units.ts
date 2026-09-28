export const PURCHASE_UNITS = [
  "sheet",
  "roll",
  "linear_metre",
  "square_metre",
  "unit",
  "pack",
] as const;

export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

export const PURCHASE_UNIT_LABELS: Record<PurchaseUnit, string> = {
  sheet: "Sheet",
  roll: "Roll",
  linear_metre: "Linear metre",
  square_metre: "Square metre",
  unit: "Unit",
  pack: "Pack",
};

export function isPurchaseUnit(value: string): value is PurchaseUnit {
  return (PURCHASE_UNITS as readonly string[]).includes(value);
}
