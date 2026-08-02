import { NextResponse } from "next/server";

import { CustomerSettingsError } from "@/lib/customer-settings/errors";

export function customerSettingsErrorResponse(error: unknown) {
  if (error instanceof CustomerSettingsError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
