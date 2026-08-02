import { NextResponse } from "next/server";

import {
  CUSTOMER_SETTINGS_SAVE_ERROR,
} from "@/lib/customer-settings/save-with-activity";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";

export function customerSettingsErrorResponse(error: unknown) {
  if (error instanceof CustomerSettingsError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: CUSTOMER_SETTINGS_SAVE_ERROR }, { status: 500 });
}
