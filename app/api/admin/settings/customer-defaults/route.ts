import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  parsePaymentTermsDays,
  PAYMENT_TERMS_MAX_DAYS,
  PAYMENT_TERMS_MIN_DAYS,
} from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/server";

type CustomerDefaultsBody = {
  defaultCompanyPaymentTermsDays?: number;
  defaultRegistrationAccountStatus?: string;
  defaultDeadlineStatus?: string;
};

const allowedAccountStatuses = new Set(["pending", "approved"]);
const allowedDeadlineStatuses = new Set(["pending", "approved"]);

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: CustomerDefaultsBody;

  try {
    body = (await request.json()) as CustomerDefaultsBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const paymentTerms = parsePaymentTermsDays(
    body.defaultCompanyPaymentTermsDays ?? NaN
  );

  if (paymentTerms === null) {
    return NextResponse.json(
      {
        error: `New customer payment terms must be a whole number between ${PAYMENT_TERMS_MIN_DAYS} and ${PAYMENT_TERMS_MAX_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  const registrationStatus = body.defaultRegistrationAccountStatus?.trim();
  const deadlineStatus = body.defaultDeadlineStatus?.trim();

  if (!registrationStatus || !allowedAccountStatuses.has(registrationStatus)) {
    return NextResponse.json(
      { error: "Default registration account status is invalid." },
      { status: 400 }
    );
  }

  if (!deadlineStatus || !allowedDeadlineStatuses.has(deadlineStatus)) {
    return NextResponse.json(
      { error: "Default deadline status is invalid." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("app_settings")
    .update({
      default_company_payment_terms_days: paymentTerms,
      default_registration_account_status: registrationStatus,
      default_deadline_status: deadlineStatus,
      updated_by: authResult.userId,
    })
    .eq("singleton", true)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to save customer defaults." },
      { status: 400 }
    );
  }

  revalidatePath("/admin/settings");

  return NextResponse.json({ success: true });
}
