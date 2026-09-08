import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isProductUpdateAudience,
  isProductUpdateCategory,
  isSchemaMissingError,
  type ProductUpdateAudience,
  type ProductUpdateCategory,
  type ProductUpdateRecord,
} from "@/lib/updates/types";

export type UpsertProductUpdateInput = {
  title: string;
  body: string;
  category: ProductUpdateCategory;
  audience: ProductUpdateAudience;
  isPublished: boolean;
  publishedAt?: string | null;
  createdBy: string;
};

function normalizePublishedFields(input: {
  isPublished: boolean;
  publishedAt?: string | null;
}) {
  if (!input.isPublished) {
    return { is_published: false, published_at: null };
  }

  return {
    is_published: true,
    published_at: input.publishedAt ?? new Date().toISOString(),
  };
}

export function validateProductUpdateInput(input: {
  title?: string;
  body?: string;
  category?: string;
  audience?: string;
}) {
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  const category = input.category?.trim() ?? "";
  const audience = input.audience?.trim() ?? "";

  if (!title) {
    return { ok: false as const, message: "Title is required." };
  }

  if (!body) {
    return { ok: false as const, message: "Body is required." };
  }

  if (!isProductUpdateCategory(category)) {
    return { ok: false as const, message: "Invalid category." };
  }

  if (!isProductUpdateAudience(audience)) {
    return { ok: false as const, message: "Invalid audience." };
  }

  return {
    ok: true as const,
    value: { title, body, category, audience },
  };
}

export async function createProductUpdate(
  supabase: SupabaseClient,
  input: UpsertProductUpdateInput
) {
  const published = normalizePublishedFields(input);

  const { data, error } = await supabase
    .from("product_updates")
    .insert({
      title: input.title,
      body: input.body,
      category: input.category,
      audience: input.audience,
      created_by: input.createdBy,
      ...published,
    })
    .select("*")
    .single();

  if (error) {
    return { ok: false as const, message: error.message };
  }

  return { ok: true as const, update: data as ProductUpdateRecord };
}

export async function updateProductUpdate(
  supabase: SupabaseClient,
  updateId: string,
  input: Omit<UpsertProductUpdateInput, "createdBy">
) {
  const published = normalizePublishedFields(input);

  const { data, error } = await supabase
    .from("product_updates")
    .update({
      title: input.title,
      body: input.body,
      category: input.category,
      audience: input.audience,
      ...published,
    })
    .eq("id", updateId)
    .select("*")
    .single();

  if (error) {
    return { ok: false as const, message: error.message };
  }

  return { ok: true as const, update: data as ProductUpdateRecord };
}

export async function deleteProductUpdate(
  supabase: SupabaseClient,
  updateId: string
) {
  const { error } = await supabase
    .from("product_updates")
    .delete()
    .eq("id", updateId);

  if (error) {
    if (isSchemaMissingError(error)) {
      return { ok: false as const, message: "Updates are not available yet." };
    }

    return { ok: false as const, message: error.message };
  }

  return { ok: true as const };
}

export function buildCreateUpdateFromReportPrefill(input: {
  title?: string;
  body?: string;
  audience?: ProductUpdateAudience;
}) {
  return {
    title: input.title?.trim() || "Issue resolved",
    body:
      input.body?.trim() ||
      "We resolved an issue reported through Candid OS. Thank you for your feedback.",
    category: "fix" as const,
    audience: input.audience ?? ("everyone" as ProductUpdateAudience),
  };
}

export function sanitizePublicUpdatePrefillFromReport() {
  return buildCreateUpdateFromReportPrefill({
    title: "Issue resolved",
    body: "We resolved an issue reported through Candid OS. Thank you for your feedback.",
  });
}
