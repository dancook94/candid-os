import type { SupabaseClient } from "@supabase/supabase-js";

import {
  audienceMatchesUserRole,
  isSchemaMissingError,
  type ProductUpdateRecord,
} from "@/lib/updates/types";

const PRODUCT_UPDATE_SELECT = `
  id,
  title,
  body,
  category,
  audience,
  is_published,
  published_at,
  created_by,
  created_at,
  updated_at
`;

export async function fetchVisibleProductUpdates(
  supabase: SupabaseClient,
  options: {
    userRole: string;
    includeUnpublished?: boolean;
  }
) {
  let query = supabase
    .from("product_updates")
    .select(PRODUCT_UPDATE_SELECT)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (!options.includeUnpublished) {
    query = query.eq("is_published", true).lte("published_at", new Date().toISOString());
  }

  const { data, error } = await query;

  if (error) {
    if (isSchemaMissingError(error)) {
      return { updates: [] as ProductUpdateRecord[], schemaMissing: true, error: null };
    }

    return {
      updates: [] as ProductUpdateRecord[],
      schemaMissing: false,
      error: error.message,
    };
  }

  const updates = ((data ?? []) as ProductUpdateRecord[]).filter((update) => {
    if (options.includeUnpublished) {
      return true;
    }

    return audienceMatchesUserRole(update.audience, options.userRole);
  });

  return { updates, schemaMissing: false, error: null };
}

export async function fetchUnreadProductUpdateCount(
  supabase: SupabaseClient,
  userId: string,
  userRole: string
) {
  const { updates, schemaMissing, error } = await fetchVisibleProductUpdates(
    supabase,
    { userRole }
  );

  if (schemaMissing || error || updates.length === 0) {
    return { count: 0, schemaMissing: schemaMissing ?? false, error };
  }

  const updateIds = updates.map((update) => update.id);

  const { data: reads, error: readsError } = await supabase
    .from("product_update_reads")
    .select("update_id")
    .eq("user_id", userId)
    .in("update_id", updateIds);

  if (readsError) {
    if (isSchemaMissingError(readsError)) {
      return { count: 0, schemaMissing: true, error: null };
    }

    return { count: 0, schemaMissing: false, error: readsError.message };
  }

  const readIds = new Set((reads ?? []).map((read) => read.update_id));
  const unreadCount = updates.filter((update) => !readIds.has(update.id)).length;

  return { count: unreadCount, schemaMissing: false, error: null };
}

export async function markVisibleProductUpdatesAsRead(
  supabase: SupabaseClient,
  userId: string,
  userRole: string
) {
  const { updates, schemaMissing, error } = await fetchVisibleProductUpdates(
    supabase,
    { userRole }
  );

  if (schemaMissing || error || updates.length === 0) {
    return { ok: true as const, markedCount: 0, schemaMissing, error };
  }

  const rows = updates.map((update) => ({
    update_id: update.id,
    user_id: userId,
    read_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from("product_update_reads")
    .upsert(rows, { onConflict: "update_id,user_id" });

  if (upsertError) {
    if (isSchemaMissingError(upsertError)) {
      return { ok: true as const, markedCount: 0, schemaMissing: true, error: null };
    }

    return {
      ok: false as const,
      markedCount: 0,
      schemaMissing: false,
      error: upsertError.message,
    };
  }

  return {
    ok: true as const,
    markedCount: rows.length,
    schemaMissing: false,
    error: null,
  };
}

export async function fetchProductUpdateById(
  supabase: SupabaseClient,
  updateId: string
) {
  const { data, error } = await supabase
    .from("product_updates")
    .select(PRODUCT_UPDATE_SELECT)
    .eq("id", updateId)
    .maybeSingle();

  if (error) {
    if (isSchemaMissingError(error)) {
      return { update: null, schemaMissing: true, error: null };
    }

    return { update: null, schemaMissing: false, error: error.message };
  }

  return {
    update: (data as ProductUpdateRecord | null) ?? null,
    schemaMissing: false,
    error: null,
  };
}
