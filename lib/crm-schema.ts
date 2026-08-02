import type { SupabaseClient } from "@supabase/supabase-js";

export type CrmSchemaAvailability = {
  isAvailable: boolean;
  errorMessage: string | null;
};

export async function checkCrmSchemaAvailability(
  supabase: SupabaseClient
): Promise<CrmSchemaAvailability> {
  const { error } = await supabase.from("opportunities").select("id").limit(1);

  if (!error) {
    return { isAvailable: true, errorMessage: null };
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  ) {
    return { isAvailable: false, errorMessage: null };
  }

  return { isAvailable: false, errorMessage: error.message };
}
