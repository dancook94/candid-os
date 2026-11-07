import { NextResponse } from "next/server";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { validateActiveContactForCompany } from "@/lib/crm/contact-validation";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { computeDefaultQuoteExpiryDate } from "@/lib/app-settings";
import { loadAppSettings } from "@/lib/app-settings-server";
import {
  repeatQuoteRefreshFlag,
  type RepeatMaterialPricingMode,
} from "@/lib/quotes/repeat-quote";
import { createClient } from "@/lib/supabase/server";

type RepeatQuoteBody = {
  sourceVersionId?: string;
  materialPricingMode?: RepeatMaterialPricingMode;
  idempotencyKey?: string;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: quoteId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: RepeatQuoteBody;

  try {
    body = (await request.json()) as RepeatQuoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const sourceVersionId = body.sourceVersionId?.trim();
  const idempotencyKey = body.idempotencyKey?.trim();
  const materialPricingMode = body.materialPricingMode ?? "refresh_catalogue";

  if (!sourceVersionId || !idempotencyKey) {
    return NextResponse.json(
      { error: "Quote version and idempotency key are required." },
      { status: 400 }
    );
  }

  if (materialPricingMode !== "refresh_catalogue" && materialPricingMode !== "keep_saved") {
    return NextResponse.json({ error: "Invalid material pricing mode." }, { status: 400 });
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, quote_number, company_id, contact_id, project_name")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return NextResponse.json({ error: quoteError.message }, { status: 500 });
  }

  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  const { data: sourceVersion, error: versionError } = await supabase
    .from("quote_versions")
    .select("id, version_number, quote_id")
    .eq("id", sourceVersionId)
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  if (!sourceVersion) {
    return NextResponse.json({ error: "Quote version not found." }, { status: 404 });
  }

  const contactValidation = await validateActiveContactForCompany(
    supabase,
    quote.contact_id,
    quote.company_id,
    { required: true }
  );

  if (!contactValidation.ok) {
    return NextResponse.json({ error: contactValidation.message }, { status: 400 });
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, is_active, company_name")
    .eq("id", quote.company_id)
    .maybeSingle();

  if (companyError) {
    return NextResponse.json({ error: companyError.message }, { status: 500 });
  }

  if (!company?.is_active) {
    return NextResponse.json(
      { error: "Company must be active before this quote can be repeated." },
      { status: 400 }
    );
  }

  const appSettingsResult = await loadAppSettings(supabase);
  const expiryDate = computeDefaultQuoteExpiryDate(
    appSettingsResult.settings.default_quote_expiry_days
  );

  const { data: newQuoteId, error: repeatError } = await supabase.rpc("repeat_quote", {
    p_source_version_id: sourceVersionId,
    p_refresh_material_rates: repeatQuoteRefreshFlag(materialPricingMode),
    p_idempotency_key: idempotencyKey,
    p_expiry_date: expiryDate,
  });

  if (repeatError || !newQuoteId) {
    return NextResponse.json(
      { error: repeatError?.message ?? "Unable to repeat quote." },
      { status: 400 }
    );
  }

  const { data: newQuote, error: newQuoteError } = await supabase
    .from("quotes")
    .select("id, quote_number")
    .eq("id", newQuoteId)
    .maybeSingle();

  if (newQuoteError) {
    return NextResponse.json({ error: newQuoteError.message }, { status: 500 });
  }

  if (!newQuote) {
    return NextResponse.json({ error: "Repeated quote could not be loaded." }, { status: 500 });
  }

  try {
    await createCrmActivity(supabase, {
      companyId: quote.company_id,
      contactId: quote.contact_id,
      quoteId: newQuote.id,
      activityType: CRM_ACTIVITY_TYPES.quoteRepeated,
      description: `Quote Q-${newQuote.quote_number} created as a repeat of Q-${quote.quote_number} (version ${sourceVersion.version_number}).`,
      metadata: {
        source_quote_id: quote.id,
        source_quote_number: quote.quote_number,
        source_version_id: sourceVersion.id,
        source_version_number: sourceVersion.version_number,
        material_pricing_mode: materialPricingMode,
        new_quote_number: newQuote.quote_number,
      },
      actorProfileId: auth.userId,
    });

    await createCrmActivity(supabase, {
      companyId: quote.company_id,
      contactId: quote.contact_id,
      quoteId: quote.id,
      activityType: CRM_ACTIVITY_TYPES.quoteRepeated,
      description: `Repeat quote Q-${newQuote.quote_number} was created from this quote (version ${sourceVersion.version_number}).`,
      metadata: {
        new_quote_id: newQuote.id,
        new_quote_number: newQuote.quote_number,
        source_version_number: sourceVersion.version_number,
        material_pricing_mode: materialPricingMode,
      },
      actorProfileId: auth.userId,
    });
  } catch {
    // Activity logging must not roll back the repeated quote.
  }

  return NextResponse.json({
    ok: true,
    quoteId: newQuote.id,
    quoteNumber: newQuote.quote_number,
  });
}
