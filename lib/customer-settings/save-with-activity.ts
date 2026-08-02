import type { CustomerSettingsContext } from "@/lib/customer-settings/auth";
import {
  logCustomerSettingsActivity,
  type CustomerSettingsActivityType,
} from "@/lib/customer-settings/activity";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";

export const CUSTOMER_SETTINGS_SAVE_ERROR =
  "Your changes could not be saved. Please try again.";

export type CustomerSettingsActivityPayload = {
  activityType: CustomerSettingsActivityType;
  description: string;
  changedFields: string[];
  addressId?: string | null;
  contactId?: string | null;
};

type CommitCustomerSettingsChangeInput<T> = {
  context: CustomerSettingsContext;
  operation: () => Promise<T>;
  rollback: () => Promise<void>;
  activity: CustomerSettingsActivityPayload | ((result: T) => CustomerSettingsActivityPayload);
  devOperationLabel: string;
};

export async function commitCustomerSettingsChange<T>({
  context,
  operation,
  rollback,
  activity,
  devOperationLabel,
}: CommitCustomerSettingsChangeInput<T>): Promise<T> {
  const result = await operation();
  const activityPayload =
    typeof activity === "function" ? activity(result) : activity;

  try {
    await logCustomerSettingsActivity(context, activityPayload);
    return result;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[portal settings] rolling back after activity failure", {
        operation: devOperationLabel,
        activityType: activityPayload.activityType,
        code: (error as { code?: string }).code,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await rollback();
    } catch (rollbackError) {
      if (process.env.NODE_ENV === "development") {
        console.error("[portal settings] rollback failed", {
          operation: devOperationLabel,
          message:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        });
      }
    }

    throw new CustomerSettingsError(CUSTOMER_SETTINGS_SAVE_ERROR, 500);
  }
}
