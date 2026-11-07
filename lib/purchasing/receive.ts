export function receivePurchaseOrderErrorMessage(error: { message?: string } | null) {
  const message = error?.message?.trim() ?? "";

  if (
    message === "Each receipt line needs a line and a positive quantity" ||
    message === "A receipt needs at least one line" ||
    message === "Receipt lines must not repeat a purchase order line"
  ) {
    return message.endsWith(".") ? message : `${message}.`;
  }

  if (message.includes("cannot receive more than was ordered")) {
    return "A line cannot receive more than was ordered.";
  }

  if (message === "Goods can only be received against the current issued revision") {
    return "Goods can only be received against the current issued revision.";
  }

  return message
    ? message.endsWith(".")
      ? message
      : `${message}.`
    : "The receipt could not be recorded.";
}
