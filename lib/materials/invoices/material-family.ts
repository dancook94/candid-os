export const MATERIAL_FAMILY_IDS = [
  "foamalite",
  "dibond",
  "acrylic",
  "vinyl",
  "banner",
  "paper",
  "fabric",
] as const;

export type MaterialFamily = (typeof MATERIAL_FAMILY_IDS)[number];

const FAMILY_PATTERNS: Record<MaterialFamily, readonly RegExp[]> = {
  foamalite: [/\bfoamalite\b/i, /\bfoamex\b/i, /\bfoam\s+pvc\b/i],
  dibond: [/\bdibond\b/i, /\baluminium composite\b/i, /\baluminum composite\b/i, /\bacm\b/i],
  acrylic: [/\bacrylic\b/i, /\bperspex\b/i, /\bplexiglass\b/i],
  vinyl: [/\bvinyl\b/i, /\bbriteline\b/i, /\bmonomeric\b/i, /\bpolymeric\b/i],
  banner: [/\bbanner\b/i],
  paper: [/\bpaper\b/i],
  fabric: [/\bfabric\b/i, /\btextile\b/i],
};

export function materialFamilies(text: string): MaterialFamily[] {
  return MATERIAL_FAMILY_IDS.filter((family) =>
    FAMILY_PATTERNS[family].some((pattern) => pattern.test(text))
  );
}

export function materialFamiliesConflict(left: string, right: string) {
  const leftFamilies = materialFamilies(left);
  const rightFamilies = materialFamilies(right);

  return (
    leftFamilies.length === 1 &&
    rightFamilies.length === 1 &&
    leftFamilies[0] !== rightFamilies[0]
  );
}

export function statedAdhesive(text: string) {
  const permanent = /\bpermanent\b/i.test(text);
  const removable = /\bremovable\b/i.test(text);

  if (permanent === removable) {
    return null;
  }

  return permanent ? "permanent" : "removable";
}
