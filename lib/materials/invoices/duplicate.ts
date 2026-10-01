export type ExistingInvoiceRef = {
  id: string;
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  checksumSha256: string;
};

export function findDuplicateInvoice(input: {
  checksumSha256: string;
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  existing: readonly ExistingInvoiceRef[];
}) {
  const byChecksum = input.existing.find(
    (invoice) => invoice.checksumSha256 === input.checksumSha256
  );

  if (byChecksum) {
    return { invoiceId: byChecksum.id, reason: "This file has already been uploaded." };
  }

  const number = input.invoiceNumber?.trim().toLowerCase() ?? "";

  if (!input.supplierId || !number) {
    return null;
  }

  const byIdentity = input.existing.find((invoice) => {
    if (invoice.supplierId !== input.supplierId) {
      return false;
    }

    if ((invoice.invoiceNumber ?? "").trim().toLowerCase() !== number) {
      return false;
    }

    if (input.invoiceDate && invoice.invoiceDate && invoice.invoiceDate !== input.invoiceDate) {
      return false;
    }

    return true;
  });

  if (!byIdentity) {
    return null;
  }

  return {
    invoiceId: byIdentity.id,
    reason: "An invoice with this supplier and invoice number is already stored.",
  };
}
