export const DUPLICATE_DRAFT_WINDOW_MS = 5000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CreateDraftErrorCode =
  | "invalid"
  | "inactive"
  | "missing"
  | "forbidden"
  | "failed";

export function isPurchaseOrderSupplierId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function purchaseOrderIdFromCreateResult(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const orderId = (data as { purchaseOrderId?: unknown }).purchaseOrderId;

  return isPurchaseOrderSupplierId(orderId) ? orderId : null;
}

export function createDraftErrorCode(error: {
  code?: string;
  message?: string;
} | null): CreateDraftErrorCode {
  const message = error?.message?.toLowerCase() ?? "";

  if (message.includes("not active")) {
    return "inactive";
  }

  if (message.includes("not found")) {
    return "missing";
  }

  if (
    error?.code === "42501" ||
    message.includes("permission") ||
    message.includes("not authorized") ||
    message.includes("not authorised")
  ) {
    return "forbidden";
  }

  return "failed";
}

export type PurchaseOrderCreateErrorLog = {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
};

export function purchaseOrderCreateErrorLog(
  error: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  } | null
): PurchaseOrderCreateErrorLog {
  return {
    code: diagnosticText(error?.code),
    message: diagnosticText(error?.message),
    details: diagnosticText(error?.details),
    hint: diagnosticText(error?.hint),
  };
}

function diagnosticText(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function createDraftErrorMessage(code: string | undefined) {
  switch (code) {
    case "invalid":
      return "Choose an active supplier before creating a draft.";
    case "inactive":
      return "That supplier is no longer active.";
    case "missing":
      return "That supplier could not be found.";
    case "forbidden":
      return "You do not have permission to create a purchase order.";
    case "failed":
      return "The draft could not be created.";
    default:
      return null;
  }
}

export function recentDuplicateDraftId(
  drafts: { id: string; createdAt: string }[],
  now: number
) {
  const cutoff = now - DUPLICATE_DRAFT_WINDOW_MS;

  const recent = drafts
    .filter((draft) => isPurchaseOrderSupplierId(draft.id))
    .map((draft) => ({
      id: draft.id,
      createdAt: new Date(draft.createdAt).getTime(),
    }))
    .filter((draft) => Number.isFinite(draft.createdAt) && draft.createdAt >= cutoff)
    .sort((left, right) => right.createdAt - left.createdAt);

  return recent[0]?.id ?? null;
}
