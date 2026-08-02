import { NextResponse } from "next/server";

import { requireCustomerQuoteRequestContext } from "@/lib/customer-settings/auth";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import {
  QUOTE_REQUEST_SUBMIT_ERROR,
  submitCustomerQuoteRequest,
} from "@/lib/quote-request/submit-customer-quote-request";
import type { SubmitCustomerQuoteRequestBody } from "@/lib/quote-request/types";
import { loadAppSettings } from "@/lib/app-settings-server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerQuoteRequestContext(supabase, user);

    let body: SubmitCustomerQuoteRequestBody;

    try {
      body = (await request.json()) as SubmitCustomerQuoteRequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const appSettingsResult = await loadAppSettings(supabase);

    const result = await submitCustomerQuoteRequest(
      context,
      body,
      appSettingsResult.settings.default_deadline_status
    );

    return NextResponse.json({
      success: true,
      quoteRequestId: result.quoteRequestId,
      addressReused: result.addressReused ?? false,
      addressSaved: result.addressSaved ?? false,
      message: result.addressReused
        ? "Quote request submitted. This address is already saved."
        : "Quote request submitted.",
    });
  } catch (error) {
    if (error instanceof CustomerSettingsError) {
      return customerSettingsErrorResponse(error);
    }

    if (process.env.NODE_ENV === "development" && error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { error: QUOTE_REQUEST_SUBMIT_ERROR },
      { status: 500 }
    );
  }
}
