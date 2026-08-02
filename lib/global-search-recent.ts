import type { GlobalSearchResultType } from "@/lib/crm/global-search-query";

export type RecentSearchItem = {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  href: string;
  viewedAt: number;
};

const STORAGE_KEY = "candid-os-global-search-recent";
const MAX_RECENT_ITEMS = 8;

export function loadRecentSearchItems(): RecentSearchItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as RecentSearchItem[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.type === "string" &&
          typeof item.title === "string" &&
          typeof item.href === "string"
      )
      .slice(0, MAX_RECENT_ITEMS);
  } catch {
    return [];
  }
}

export function saveRecentSearchItem(item: Omit<RecentSearchItem, "viewedAt">) {
  if (typeof window === "undefined") {
    return;
  }

  const nextItem: RecentSearchItem = {
    ...item,
    subtitle: item.subtitle ?? "",
    viewedAt: Date.now(),
  };

  const existing = loadRecentSearchItems().filter(
    (entry) => !(entry.id === nextItem.id && entry.type === nextItem.type)
  );

  const updated = [nextItem, ...existing].slice(0, MAX_RECENT_ITEMS);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}
