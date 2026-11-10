export const WORK_CLASSES = ["print_supply", "delivery", "installation"] as const;

export type WorkClass = (typeof WORK_CLASSES)[number];

export const WORK_CLASS_LABELS: Record<WorkClass, string> = {
  print_supply: "Print / supply",
  delivery: "Delivery",
  installation: "Installation",
};

const PRINT_OR_SUPPLY_COMPONENTS = new Set([
  "printing",
  "finishing",
  "labour",
  "outsourcing",
  "other",
  "one_off",
]);

export const HISTORICAL_RECONCILE_SKIP_REASON = "Not a phase 2 acceptance.";

export function isWorkClass(value: unknown): value is WorkClass {
  return WORK_CLASSES.includes(value as WorkClass);
}

export function suggestWorkClass(componentTypes: readonly string[]): WorkClass | null {
  const types = componentTypes.map((type) => type.trim()).filter(Boolean);

  if (types.length === 0) {
    return null;
  }

  if (types.includes("installation")) {
    return "installation";
  }

  const hasDelivery = types.includes("delivery");
  const hasPrintOrSupply = types.some((type) => PRINT_OR_SUPPLY_COMPONENTS.has(type));

  if (hasDelivery && !hasPrintOrSupply) {
    return "delivery";
  }

  return "print_supply";
}

export function effectiveWorkClass(input: {
  overridden: boolean;
  current: WorkClass | null;
  componentTypes: readonly string[];
}): WorkClass | null {
  if (input.overridden) {
    return input.current;
  }

  return suggestWorkClass(input.componentTypes);
}

export function lineIsIncludedInAcceptance(input: {
  isOptional: boolean;
  isSelected: boolean | null;
}) {
  if (!input.isOptional) {
    return true;
  }

  return input.isSelected === true;
}

export function unclassifiedIncludedLineTitles(
  lines: readonly {
    title: string;
    isOptional: boolean;
    isSelected: boolean | null;
    workClass: string | null;
  }[]
) {
  return lines
    .filter((line) => lineIsIncludedInAcceptance(line) && !isWorkClass(line.workClass))
    .map((line) => line.title.trim() || "Untitled line");
}

export function acceptanceBlockedMessage(titles: readonly string[]) {
  if (titles.length === 0) {
    return null;
  }

  return `Classify every included line before accepting this quote: ${titles.join(", ")}.`;
}

export function quoteRequiresInstallation(
  lines: readonly {
    isOptional: boolean;
    isSelected: boolean | null;
    workClass: string | null;
  }[]
) {
  return lines.some(
    (line) => lineIsIncludedInAcceptance(line) && line.workClass === "installation"
  );
}

export function installationReconcileIsRetryable(input: {
  autoReconcile: boolean;
  status: string | null;
}) {
  return input.autoReconcile && input.status === "failed";
}
