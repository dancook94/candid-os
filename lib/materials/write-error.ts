type PostgrestLikeError = {
  code?: string;
  message?: string;
};

export function mapMaterialsWriteError(error: PostgrestLikeError) {
  const message = error.message ?? "";

  if (error.code === "23505") {
    if (message.includes("materials_identity_key")) {
      return "A material with this specification already exists.";
    }

    if (message.includes("suppliers_normalized_name")) {
      return "A supplier with this name already exists.";
    }

    if (message.includes("material_supplier_products_description")) {
      return "This supplier already has a product with that description.";
    }

    if (message.includes("material_supplier_products_sku")) {
      return "This supplier already has a product with that SKU.";
    }

    if (message.includes("material_supplier_products_one_preferred")) {
      return "This material already has a preferred supplier product.";
    }
  }

  if (error.code === "23514") {
    return "That value is not allowed.";
  }

  if (error.code === "23503") {
    return "That supplier or material could not be found.";
  }

  if (message.includes("Inactive supplier products cannot be preferred")) {
    return "An inactive supplier product cannot be preferred.";
  }

  return "Unable to save. Check the details and try again.";
}

export function isMaterialsSchemaMissing(error: PostgrestLikeError | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (error.message ?? "").includes("schema cache") ||
    (error.message ?? "").toLowerCase().includes("does not exist")
  );
}
