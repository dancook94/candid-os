import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CustomerSettingsPanel } from "@/components/customer-settings-panel";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import { requireCustomerSettingsContext } from "@/lib/customer-settings/auth";
import { loadCustomerSettingsPayload } from "@/lib/customer-settings/load-settings";
import {
  buildCustomerAppShellProps,
  loadCustomerPortalProfile,
} from "@/lib/customer-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomerSettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  try {
    const context = await requireCustomerSettingsContext(supabase, user);
    const profile = await loadCustomerPortalProfile(supabase, user.id);
    const [shellProps, initialData] = await Promise.all([
      buildCustomerAppShellProps(supabase, user, profile),
      loadCustomerSettingsPayload(supabase, context),
    ]);

    return (
      <AppShell {...shellProps}>
        <CustomerSettingsPanel initialData={initialData} />
      </AppShell>
    );
  } catch (error) {
    if (error instanceof CustomerSettingsError && error.status === 403) {
      redirect("/dashboard");
    }

    throw error;
  }
}
