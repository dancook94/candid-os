export class CustomerSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CustomerSettingsError";
    this.status = status;
  }
}

export {
  isMissingColumnError,
  isMissingRelationError,
  isSchemaMismatchError,
  logPortalSettingsQueryError,
  toCustomerFacingDatabaseMessage,
} from "@/lib/customer-settings/query-errors";
