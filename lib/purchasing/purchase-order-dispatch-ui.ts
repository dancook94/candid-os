export type PurchaseOrderEmailDispatch = {
  id: string;
  status: string;
  attemptCount: number;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function purchaseOrderEmailRecipientEditable(
  dispatch: PurchaseOrderEmailDispatch | null
) {
  if (!dispatch) {
    return true;
  }

  return dispatch.status === "failed" || dispatch.status === "queued";
}

export function purchaseOrderCanSendEmail(dispatch: PurchaseOrderEmailDispatch | null) {
  if (!dispatch) {
    return true;
  }

  if (dispatch.status === "sent") {
    return false;
  }

  if (dispatch.status === "sending" || dispatch.status === "unknown") {
    return false;
  }

  return dispatch.status === "queued" || dispatch.status === "failed";
}
