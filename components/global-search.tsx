"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Building2,
  CheckSquare,
  FileText,
  Search,
  Target,
  Users,
  X,
} from "lucide-react";

import type {
  GlobalSearchGroupedResults,
  GlobalSearchResult,
  GlobalSearchResultType,
} from "@/lib/crm/global-search-query";
import {
  loadRecentSearchItems,
  saveRecentSearchItem,
  type RecentSearchItem,
} from "@/lib/global-search-recent";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

type GlobalSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type GlobalSearchTriggerProps = {
  onOpen: () => void;
  className?: string;
};

const GROUP_LABELS: Record<GlobalSearchResultType, string> = {
  company: "Companies",
  contact: "Contacts",
  opportunity: "Opportunities",
  quote: "Quotes",
  task: "Tasks",
};

const TYPE_ICONS: Record<
  GlobalSearchResultType,
  React.ComponentType<{ className?: string }>
> = {
  company: Building2,
  contact: Users,
  opportunity: Target,
  quote: FileText,
  task: CheckSquare,
};

function useShortcutLabel() {
  const [label, setLabel] = useState("Ctrl K");

  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    setLabel(isMac ? "⌘K" : "Ctrl K");
  }, []);

  return label;
}

function resultValue(result: Pick<GlobalSearchResult, "type" | "id">) {
  return `${result.type}:${result.id}`;
}

function flattenResults(results: GlobalSearchGroupedResults) {
  return [
    ...results.companies,
    ...results.contacts,
    ...results.opportunities,
    ...results.quotes,
    ...results.tasks,
  ];
}

function hasAnyResults(results: GlobalSearchGroupedResults) {
  return flattenResults(results).length > 0;
}

export function GlobalSearchTrigger({
  onOpen,
  className,
}: GlobalSearchTriggerProps) {
  const shortcutLabel = useShortcutLabel();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
        className
      )}
      aria-label="Search Candid OS"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">Search Candid OS</span>
      <kbd className="hidden rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
        {shortcutLabel}
      </kbd>
    </button>
  );
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchGroupedResults | null>(
    null
  );
  const [recentItems, setRecentItems] = useState<RecentSearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const showRecent = trimmedQuery.length < MIN_QUERY_LENGTH;

  const resetState = useCallback(() => {
    setQuery("");
    setResults(null);
    setError(null);
    setIsLoading(false);
    setRecentItems(loadRecentSearchItems());
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    resetState();

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open, resetState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      void (async () => {
        try {
          const response = await fetch(
            `/api/admin/global-search?q=${encodeURIComponent(trimmedQuery)}`
          );
          const payload = (await response.json()) as {
            results?: GlobalSearchGroupedResults;
            error?: string;
          };

          if (requestId !== requestIdRef.current) {
            return;
          }

          if (!response.ok) {
            setResults(null);
            setError(payload.error ?? "Search unavailable. Please try again.");
            return;
          }

          setResults(payload.results ?? null);
        } catch {
          if (requestId !== requestIdRef.current) {
            return;
          }

          setResults(null);
          setError("Search unavailable. Please try again.");
        } finally {
          if (requestId === requestIdRef.current) {
            setIsLoading(false);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [open, trimmedQuery]);

  const groupedEntries = useMemo(() => {
    if (showRecent) {
      return recentItems.length > 0
        ? [{ label: "Recently viewed", items: recentItems }]
        : [];
    }

    if (!results) {
      return [];
    }

    return (
      [
        ["company", results.companies],
        ["contact", results.contacts],
        ["opportunity", results.opportunities],
        ["quote", results.quotes],
        ["task", results.tasks],
      ] as const
    )
      .filter(([, items]) => items.length > 0)
      .map(([type, items]) => ({
        label: GROUP_LABELS[type],
        items,
      }));
  }, [recentItems, results, showRecent]);

  function handleSelect(item: GlobalSearchResult | RecentSearchItem) {
    saveRecentSearchItem({
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      href: item.href,
    });

    onOpenChange(false);
    router.push(item.href);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search Candid OS"
      shouldFilter={false}
      loop
      className="fixed inset-0 z-[100]"
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="fixed inset-x-0 top-[8vh] mx-auto w-[min(100%-2rem,42rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Search companies, contacts, opportunities, quotes, tasks…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search query"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          {isLoading ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              Searching…
            </div>
          ) : null}

          {!isLoading && error ? (
            <div
              className="px-3 py-8 text-center text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {!isLoading && !error && showRecent && recentItems.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </div>
          ) : null}

          {!isLoading &&
          !error &&
          !showRecent &&
          results &&
          !hasAnyResults(results) ? (
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No results found
            </Command.Empty>
          ) : null}

          {groupedEntries.map((group) => (
            <Command.Group
              key={group.label}
              heading={group.label}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {group.items.map((item) => {
                const Icon = TYPE_ICONS[item.type];
                const value = resultValue(item);

                return (
                  <Command.Item
                    key={value}
                    value={value}
                    onSelect={() => handleSelect(item)}
                    className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 aria-selected:bg-muted"
                  >
                    <Icon
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </p>
                      {item.subtitle ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </p>
                      ) : null}
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}

export function useGlobalSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isModifier = event.metaKey || event.ctrlKey;

      if (!isModifier || event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      onOpen();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpen]);
}
