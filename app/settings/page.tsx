import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CustomerSettingsErrorState } from "@/components/customer-settings-error-state";
import { CustomerSettingsPanel } from "@/components/customer-settings-panel";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import { requireCustomerSettingsContext } from "@/lib/customer-settings/auth";
import { loadCustomerSettingsPayload } from "@/lib/customer-settings/load-settings";
import { toCustomerFacingDatabaseMessage } from "@/lib/customer-settings/query-errors";
import {
  buildCustomerAppShellProps,
  loadCustomerPortalProfile,
} from "@/lib/customer-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSettingsLoadErrorMessage(error: unknown) {
  if (error instanceof CustomerSettingsError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Settings could not be loaded.";
}

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
      redirect("/register/confirmed");
    }

    const profile = await loadCustomerPortalProfile(supabase, user.id);
    const shellProps = await buildCustomerAppShellProps(supabase, user, profile);
    const developmentMessage =
      process.env.NODE_ENV === "development"
        ? getSettingsLoadErrorMessage(error)
        : null;

    return (
      <AppShell {...shellProps}>
        <CustomerSettingsErrorState
          developmentMessage={
            developmentMessage
              ? toCustomerFacingDatabaseMessage(
                  { message: developmentMessage },
                  "Settings could not be loaded."
                )
              : null
          }
        />
      </AppShell>
    );
  }
}
