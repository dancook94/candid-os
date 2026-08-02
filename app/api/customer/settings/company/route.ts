import { NextResponse } from "next/server";

import {
  assertCompanyOwnership,
  assertConcurrency,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import {
  CRM_ACTIVITY_TYPES,
  logCustomerSettingsActivity,
} from "@/lib/customer-settings/activity";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type UpdateCompanyBody = {
  tradingName?: string | null;
  accountsEmail?: string | null;
  phone?: string | null;
  website?: string | null;
  updatedAt?: string | null;
};

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);
    assertCompanyOwnership(context, context.company.id);

    let body: UpdateCompanyBody;

    try {
      body = (await request.json()) as UpdateCompanyBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    assertConcurrency(context.company.updated_at, body.updatedAt ?? null);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const changedFields: string[] = [];

    if (body.tradingName !== undefined) {
      updates.trading_name = body.tradingName?.trim() || null;
      changedFields.push("trading_name");
    }

    if (body.accountsEmail !== undefined) {
      const email = body.accountsEmail?.trim().toLowerCase() ?? "";

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: "Enter a valid accounts email address." },
          { status: 400 }
        );
      }

      updates.accounts_email = email || null;
      changedFields.push("accounts_email");
    }

    if (body.phone !== undefined) {
      updates.phone = body.phone?.trim() || null;
      changedFields.push("phone");
    }

    if (body.website !== undefined) {
      updates.website = body.website?.trim() || null;
      changedFields.push("website");
    }

    if (changedFields.length === 0) {
      return NextResponse.json({ error: "No changes to save." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { error } = await adminClient
      .from("companies")
      .update(updates)
      .eq("id", context.company.id);

    if (error) {
      if (error.message.includes("column") && changedFields.includes("website")) {
        return NextResponse.json(
          {
            error:
              "Website updates require the customer settings database migration.",
          },
          { status: 501 }
        );
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logCustomerSettingsActivity(supabase, context, {
      activityType: CRM_ACTIVITY_TYPES.customerCompanyUpdated,
      description: `${context.company.company_name} company details were updated from the customer portal.`,
      changedFields,
    });

    return NextResponse.json({
      success: true,
      message: "Company details updated.",
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
