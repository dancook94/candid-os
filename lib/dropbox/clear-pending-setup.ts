"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { verifySuperAdmin } from "@/lib/admin-auth";
import { DROPBOX_OAUTH_PENDING_COOKIE } from "@/lib/dropbox/oauth";
import { createClient } from "@/lib/supabase/server";

export async function clearDropboxPendingSetup() {
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return { ok: false as const, error: authResult.message };
  }

  const cookieStore = await cookies();
  cookieStore.delete(DROPBOX_OAUTH_PENDING_COOKIE);
  revalidatePath("/admin/settings/integrations/dropbox");

  return { ok: true as const };
}
