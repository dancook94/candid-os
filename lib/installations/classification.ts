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

export type WorkRequirements = {
  printSupply: boolean;
  delivery: boolean;
  installation: boolean;
};

export function emptyWorkRequirements(): WorkRequirements {
  return { printSupply: false, delivery: false, installation: false };
}

export function hasWorkRequirement(requirements: WorkRequirements) {
  return requirements.printSupply || requirements.delivery || requirements.installation;
}

export function workRequirementsFromClass(workClass: WorkClass | null): WorkRequirements {
  if (workClass === "print_supply") {
    return { printSupply: true, delivery: false, installation: false };
  }

  if (workClass === "delivery") {
    return { printSupply: false, delivery: true, installation: false };
  }

  if (workClass === "installation") {
    return { printSupply: false, delivery: false, installation: true };
  }

  return emptyWorkRequirements();
}

export function normalizeWorkRequirements(input: {
  printSupply?: boolean | null;
  delivery?: boolean | null;
  installation?: boolean | null;
  workClass?: string | null;
}): WorkRequirements {
  const flags = {
    printSupply: input.printSupply === true,
    delivery: input.delivery === true,
    installation: input.installation === true,
  };

  if (hasWorkRequirement(flags)) {
    return flags;
  }

  return workRequirementsFromClass(isWorkClass(input.workClass) ? input.workClass : null);
}

export function compatibilityWorkClass(requirements: WorkRequirements): WorkClass | null {
  if (requirements.installation) {
    return "installation";
  }

  if (requirements.delivery && !requirements.printSupply) {
    return "delivery";
  }

  if (requirements.printSupply && !requirements.delivery) {
    return "print_supply";
  }

  return null;
}

export function suggestWorkRequirements(componentTypes: readonly string[]): WorkRequirements {
  const types = componentTypes.map((type) => type.trim()).filter(Boolean);

  if (types.length === 0) {
    return emptyWorkRequirements();
  }

  const requirements = {
    installation: types.includes("installation"),
    delivery: types.includes("delivery"),
    printSupply: types.some((type) => PRINT_OR_SUPPLY_COMPONENTS.has(type)),
  };

  return hasWorkRequirement(requirements) ? requirements : emptyWorkRequirements();
}

export function effectiveWorkRequirements(input: {
  overridden: boolean;
  current: WorkRequirements;
  componentTypes: readonly string[];
}): WorkRequirements {
  if (input.overridden) {
    return input.current;
  }

  return suggestWorkRequirements(input.componentTypes);
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

export function lineWorkRequirements(line: {
  workClass?: string | null;
  requirements?: WorkRequirements | null;
}) {
  if (line.requirements) {
    return line.requirements;
  }

  return workRequirementsFromClass(isWorkClass(line.workClass) ? line.workClass : null);
}

export function unclassifiedIncludedLineTitles(
  lines: readonly {
    title: string;
    isOptional: boolean;
    isSelected: boolean | null;
    workClass?: string | null;
    requirements?: WorkRequirements | null;
  }[]
) {
  return lines
    .filter(
      (line) =>
        lineIsIncludedInAcceptance(line) && !hasWorkRequirement(lineWorkRequirements(line))
    )
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
    workClass?: string | null;
    requirements?: WorkRequirements | null;
  }[]
) {
  return lines.some(
    (line) =>
      lineIsIncludedInAcceptance(line) && lineWorkRequirements(line).installation
  );
}

export function installationReconcileIsRetryable(input: {
  autoReconcile: boolean;
  status: string | null;
}) {
  return input.autoReconcile && input.status === "failed";
}
