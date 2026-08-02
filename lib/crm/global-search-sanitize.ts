export const GLOBAL_SEARCH_MIN_LENGTH = 2;
export const GLOBAL_SEARCH_MAX_LENGTH = 100;
export const GLOBAL_SEARCH_LIMIT_PER_CATEGORY = 5;

export function sanitizeGlobalSearchTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim().slice(0, GLOBAL_SEARCH_MAX_LENGTH);
}

export function parseQuoteNumberSearchTerm(search: string) {
  const trimmed = search.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const prefixedMatch = trimmed.match(/^q-?(\d+)$/i);

  if (prefixedMatch) {
    return Number.parseInt(prefixedMatch[1], 10);
  }

  return null;
}
