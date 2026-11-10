import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acceptanceBlockedMessage,
  unclassifiedIncludedLineTitles,
} from "@/lib/installations/classification";

export async function acceptanceClassificationError(
  supabase: SupabaseClient,
  quoteVersionId: string
) {
  const { data, error } = await supabase
    .from("quote_items")
    .select("title, is_optional, is_selected, work_class")
    .eq("quote_version_id", quoteVersionId);

  if (error) {
    return error.message;
  }

  const titles = unclassifiedIncludedLineTitles(
    (data ?? []).map((row) => ({
      title: String(row.title ?? ""),
      isOptional: row.is_optional === true,
      isSelected: row.is_selected === true ? true : row.is_selected === false ? false : null,
      workClass: row.work_class == null ? null : String(row.work_class),
    }))
  );

  return acceptanceBlockedMessage(titles);
}
