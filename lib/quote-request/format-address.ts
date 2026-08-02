import type { SavedAddressOption } from "@/lib/quote-request/types";
import {
  formatCountryLabel,
  snapshotFromCompanyAddress,
  type DeliveryAddressSnapshot,
} from "@/lib/quote-request/normalize-address";

export function toSavedAddressSnapshot(
  address: SavedAddressOption,
  companyName?: string | null
): DeliveryAddressSnapshot {
  return snapshotFromCompanyAddress(address, companyName);
}

export function formatSavedAddressOption(address: SavedAddressOption) {
  const summary = [
    address.address_line_1,
    address.city,
    address.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  return `${address.label || "Address"} — ${summary}`;
}

export { formatCountryLabel };
