export type DeliveryAddressSnapshot = {
  label: string | null;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  county: string | null;
  postcode: string;
  country: string;
  phone: string | null;
  deliveryInstructions: string | null;
};

export function normalizeAddressPart(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePostcode(postcode: string) {
  return postcode.trim().replace(/\s+/g, " ").toUpperCase();
}

export function buildAddressDuplicateKey(input: {
  addressLine1: string;
  addressLine2?: string | null;
  postcode: string;
  country?: string | null;
}) {
  return [
    normalizeAddressPart(input.addressLine1),
    normalizeAddressPart(input.addressLine2),
    normalizePostcode(input.postcode),
    normalizeAddressPart(input.country || "GB"),
  ].join("|");
}

export function isValidUkPostcode(postcode: string) {
  const normalized = normalizePostcode(postcode);

  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(normalized);
}

export function formatCountryLabel(country: string | null | undefined) {
  if (!country || country.toUpperCase() === "GB") {
    return "United Kingdom";
  }

  return country;
}

export function snapshotFromCompanyAddress(
  address: {
    label: string | null;
    recipient_name: string | null;
    address_line_1: string;
    address_line_2: string | null;
    city: string | null;
    county: string | null;
    postcode: string;
    country: string;
    phone: string | null;
    delivery_instructions: string | null;
  },
  companyName?: string | null
): DeliveryAddressSnapshot {
  return {
    label: address.label,
    recipientName: address.recipient_name || companyName || "Recipient",
    addressLine1: address.address_line_1,
    addressLine2: address.address_line_2,
    city: address.city || "",
    county: address.county,
    postcode: address.postcode,
    country: address.country || "GB",
    phone: address.phone,
    deliveryInstructions: address.delivery_instructions,
  };
}

export function formatAddressPreview(snapshot: DeliveryAddressSnapshot) {
  const lines = [
    snapshot.label,
    snapshot.recipientName,
    snapshot.addressLine1,
    snapshot.addressLine2,
    snapshot.city,
    snapshot.county,
    snapshot.postcode,
    formatCountryLabel(snapshot.country),
    snapshot.phone,
    snapshot.deliveryInstructions,
  ].filter(Boolean);

  return lines.join("\n");
}

export function formatAddressOneLine(snapshot: DeliveryAddressSnapshot) {
  return [
    snapshot.addressLine1,
    snapshot.addressLine2,
    snapshot.city,
    snapshot.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}
