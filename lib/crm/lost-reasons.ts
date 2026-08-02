export const LOST_REASON_OPTIONS = [
  "Price",
  "Competitor",
  "Project cancelled",
  "Timing",
  "No response",
  "Scope changed",
  "Quote declined",
  "Other",
] as const;

export type LostReasonOption = (typeof LOST_REASON_OPTIONS)[number];

export const LOST_REASON_QUOTE_DECLINED = "Quote declined";

export function isLostReasonOption(value: string): value is LostReasonOption {
  return (LOST_REASON_OPTIONS as readonly string[]).includes(value);
}

export function formatLostReasonForStorage(
  selected: LostReasonOption,
  otherText?: string
) {
  if (selected === "Other") {
    const trimmed = otherText?.trim();

    if (!trimmed) {
      return null;
    }

    return `Other: ${trimmed}`;
  }

  return selected;
}

export function getLostReasonOptions() {
  return LOST_REASON_OPTIONS.map((value) => ({ value, label: value }));
}
