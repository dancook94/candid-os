import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

type CompanySettingsBody = {
  companyName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressPostcode?: string;
  telephone?: string;
  website?: string;
  companyNumber?: string;
  vatNumber?: string;
  accountsEmail?: string;
  quoteEmailSenderName?: string;
  quoteEmailSenderAddress?: string;
};

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: CompanySettingsBody;

  try {
    body = (await request.json()) as CompanySettingsBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const companyName = body.companyName?.trim();

  if (!companyName) {
    return NextResponse.json(
      { error: "Company name is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("app_settings")
    .update({
      company_name: companyName,
      address_line_1: body.addressLine1?.trim() || null,
      address_line_2: body.addressLine2?.trim() || null,
      address_city: body.addressCity?.trim() || null,
      address_postcode: body.addressPostcode?.trim() || null,
      telephone: body.telephone?.trim() || null,
      website: body.website?.trim() || null,
      company_number: body.companyNumber?.trim() || null,
      vat_number: body.vatNumber?.trim() || null,
      accounts_email: body.accountsEmail?.trim() || null,
      quote_email_sender_name: body.quoteEmailSenderName?.trim() || null,
      quote_email_sender_address: body.quoteEmailSenderAddress?.trim() || null,
      updated_by: authResult.userId,
    })
    .eq("singleton", true)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to save company settings." },
      { status: 400 }
    );
  }

  revalidatePath("/admin/settings");

  return NextResponse.json({ success: true });
}
