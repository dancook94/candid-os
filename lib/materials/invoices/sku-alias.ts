export function normalizeSupplierSku(value: string) {
  return value.trim().toLowerCase();
}

export function skuAliasConflictMessage(input: {
  invoiceSku: string;
  canonicalSku: string | null;
  existingAliasProductDescription?: string | null;
}) {
  const sku = input.invoiceSku.trim();

  if (!sku) {
    return "Enter the supplier SKU from the invoice.";
  }

  if (input.canonicalSku && normalizeSupplierSku(input.canonicalSku) === normalizeSupplierSku(sku)) {
    return "This SKU is already the canonical code on the matched product.";
  }

  if (input.existingAliasProductDescription) {
    return `SKU ${sku} is already linked to “${input.existingAliasProductDescription}”. Choose that product or resolve the conflict first.`;
  }

  return null;
}
