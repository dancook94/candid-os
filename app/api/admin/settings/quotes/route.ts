import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import { parsePaymentTermsDays, PAYMENT_TERMS_MAX_DAYS, PAYMENT_TERMS_MIN_DAYS } from "@/lib/payment-terms";
import { createClient } from "@/lib/supabase/server";

type QuoteSettingsBody = {
  defaultPaymentTermsDays?: number;
  defaultQuoteExpiryDays?: number;
  defaultVatRate?: number;
  defaultIntroduction?: string;
  defaultCustomerNotes?: string;
  quoteNumberPrefix?: string;
  showProductImagesByDefault?: boolean;
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

  let body: QuoteSettingsBody;

  try {
    body = (await request.json()) as QuoteSettingsBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const paymentTerms = parsePaymentTermsDays(body.defaultPaymentTermsDays ?? NaN);

  if (paymentTerms === null) {
    return NextResponse.json(
      {
        error: `Fallback payment terms must be a whole number between ${PAYMENT_TERMS_MIN_DAYS} and ${PAYMENT_TERMS_MAX_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  const expiryDays = body.defaultQuoteExpiryDays;
  const vatRate = body.defaultVatRate;
  const prefix = body.quoteNumberPrefix?.trim();

  if (
    expiryDays === undefined ||
    !Number.isFinite(expiryDays) ||
    expiryDays < 0 ||
    expiryDays > 365
  ) {
    return NextResponse.json(
      { error: "Default quote expiry must be between 0 and 365 days." },
      { status: 400 }
    );
  }

  if (vatRate === undefined || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
    return NextResponse.json(
      { error: "Default VAT rate must be between 0 and 1." },
      { status: 400 }
    );
  }

  if (!prefix) {
    return NextResponse.json(
      { error: "Quote number prefix is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("app_settings")
    .update({
      default_payment_terms_days: paymentTerms,
      default_quote_expiry_days: expiryDays,
      default_vat_rate: vatRate,
      default_introduction: body.defaultIntroduction?.trim() || null,
      default_customer_notes: body.defaultCustomerNotes?.trim() || null,
      quote_number_prefix: prefix,
      show_product_images_by_default: Boolean(body.showProductImagesByDefault),
      updated_by: authResult.userId,
    })
    .eq("singleton", true)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to save quote defaults." },
      { status: 400 }
    );
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/quotes/new");

  return NextResponse.json({ success: true });
}
