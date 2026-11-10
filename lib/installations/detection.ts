const INSTALL_LINE_KEYWORDS = ["installation", "install", "site visit"] as const;

/**
 * Lines that mention delivery only (no install/site-visit wording) must not
 * trigger installation project creation.
 */
export function isDeliveryOnlyQuoteLine(title: string) {
  const lower = title.toLowerCase().trim();
  if (!lower.includes("delivery")) {
    return false;
  }

  if (
    lower.includes("installation") ||
    lower.includes("install") ||
    lower.includes("site visit")
  ) {
    return false;
  }

  return true;
}

export function isInstallationRelatedQuoteLine(title: string) {
  if (isDeliveryOnlyQuoteLine(title)) {
    return false;
  }

  const lower = title.toLowerCase();
  return INSTALL_LINE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export type QuoteLineInstallationSignal = {
  quoteItemId: string;
  title: string;
  fromCostComponent: boolean;
  fromSellLine: boolean;
};

export type QuoteItemForInstallationDetection = {
  id: string;
  title: string;
  is_optional: boolean;
  is_selected?: boolean | null;
};

export type CostComponentRow = {
  quote_item_id: string;
  component_type: string;
};

export function quoteItemIncludedInAcceptedVersion(item: QuoteItemForInstallationDetection) {
  if (!item.is_optional) {
    return true;
  }

  return item.is_selected === true;
}

export function detectInstallationSignals(
  quoteItems: QuoteItemForInstallationDetection[],
  costComponents: CostComponentRow[]
): QuoteLineInstallationSignal[] {
  const includedItems = quoteItems.filter(quoteItemIncludedInAcceptedVersion);
  const componentItems = new Set(
    costComponents
      .filter((row) => row.component_type === "installation")
      .map((row) => row.quote_item_id)
  );

  const byId = new Map<string, QuoteLineInstallationSignal>();

  for (const item of includedItems) {
    const fromSellLine = isInstallationRelatedQuoteLine(item.title);
    const fromCostComponent = componentItems.has(item.id);

    if (!fromSellLine && !fromCostComponent) {
      continue;
    }

    byId.set(item.id, {
      quoteItemId: item.id,
      title: item.title,
      fromCostComponent,
      fromSellLine,
    });
  }

  for (const quoteItemId of componentItems) {
    if (byId.has(quoteItemId)) {
      continue;
    }

    const item = includedItems.find((row) => row.id === quoteItemId);
    if (!item || isDeliveryOnlyQuoteLine(item.title)) {
      continue;
    }

    byId.set(quoteItemId, {
      quoteItemId,
      title: item.title,
      fromCostComponent: true,
      fromSellLine: false,
    });
  }

  return [...byId.values()];
}

export function jobRequiresInstallationProject(signals: QuoteLineInstallationSignal[]) {
  return signals.length > 0;
}
