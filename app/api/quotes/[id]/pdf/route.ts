import { NextResponse } from "next/server";

import { fetchCustomerFormalQuote } from "@/lib/customer-formal-quote-data";
import {
  buildCustomerQuotePdfFilename,
  isCustomerQuotePdfDownloadable,
} from "@/lib/customer-quote-request";
import { generateCustomerQuotePdf } from "@/lib/generate-customer-quote-pdf";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  const quote = await fetchCustomerFormalQuote(supabase, id, {
    customerContactName: fullName,
    customerEmail: user.email ?? null,
    fallbackCompanyName: companyName,
  });

  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  if (!isCustomerQuotePdfDownloadable(quote.versionStatus)) {
    return NextResponse.json(
      { error: "This quote version is not available for download." },
      { status: 403 }
    );
  }

  try {
    const pdfBuffer = await generateCustomerQuotePdf(quote);
    const filename = buildCustomerQuotePdfFilename(
      quote.quoteNumber,
      quote.versionNumber,
      quote.projectName
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to generate quote PDF:", error);
    return NextResponse.json(
      { error: "Unable to generate PDF." },
      { status: 500 }
    );
  }
}
