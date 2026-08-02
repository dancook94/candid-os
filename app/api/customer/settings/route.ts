import { NextResponse } from "next/server";

import {
  assertConcurrency,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { loadCustomerSettingsPayload } from "@/lib/customer-settings/load-settings";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);
    const payload = await loadCustomerSettingsPayload(supabase, context);

    return NextResponse.json(payload);
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
