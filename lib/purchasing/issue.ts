import type { EditorDraft } from "@/lib/purchasing/draft-editor";
import { parseDecimal, validateDraft } from "@/lib/purchasing/draft-editor";

export function validateIssueReady(draft: EditorDraft) {
  const draftError = validateDraft(draft);
  if (draftError) {
    return draftError;
  }

  if (!draft.supplierOrdersEmail.trim()) {
    return "A supplier email is required before issuing";
  }

  if (draft.lines.length === 0) {
    return "A purchase order needs at least one line";
  }

  for (const [index, line] of draft.lines.entries()) {
    const quantity = parseDecimal(line.quantity, 4);
    const allocated = line.allocations.reduce((sum, allocation) => {
      return sum + (parseDecimal(allocation.quantity, 4) ?? 0);
    }, 0);

    if (quantity === null || Math.abs(allocated - quantity) > 0.00005) {
      return `Line ${index + 1} is not fully allocated`;
    }
  }

  if (draft.deliveryChargeMethod === "manual") {
    const charge = parseDecimal(draft.deliveryChargeExVat, 2) ?? 0;
    const allocated = draft.deliveryAllocations.reduce((sum, allocation) => {
      return sum + (parseDecimal(allocation.amountExVat, 2) ?? 0);
    }, 0);

    if (Math.abs(allocated - charge) > 0.001) {
      return "Delivery charge allocations must equal the delivery charge";
    }
  }

  if (
    draft.deliveryMethod === "custom" &&
    (!draft.deliveryLine1.trim() || !draft.deliveryPostcode.trim())
  ) {
    return "Delivery address is incomplete";
  }

  return null;
}

export function issueErrorMessage(error: { code?: string; message?: string } | null) {
  const message = error?.message?.trim() ?? "";

  if (
    error?.code === "42501" ||
    message === "You do not have permission to issue purchase orders"
  ) {
    return "You do not have permission to issue this purchase order.";
  }

  if (message === "This purchase order is already issued") {
    return "This purchase order is already issued.";
  }

  if (
    message.startsWith("Line ") ||
    message.startsWith("A purchase order") ||
    message.startsWith("A supplier email") ||
    message.startsWith("Delivery ") ||
    message.startsWith("Supplier ") ||
    message.startsWith("Cancelled jobs") ||
    message.startsWith("Idempotency ") ||
    message.startsWith("Only the current draft") ||
    message.startsWith("Purchase order")
  ) {
    return message.endsWith(".") ? message : `${message}.`;
  }

  return "The purchase order could not be issued.";
}
