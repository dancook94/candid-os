import { loadCustomerCompanyBranding } from "@/lib/customer-company-branding";
import { loadCustomerPortalProfile } from "@/lib/customer-shell-props";
import { createQuotePdfResponse } from "@/lib/quotes/quote-pdf-response";
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
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const profile = await loadCustomerPortalProfile(supabase, user.id);

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const companyBranding = await loadCustomerCompanyBranding(
    supabase,
    profile?.company_id,
    (user.user_metadata?.company_name as string | undefined) || "Your company"
  );

  return createQuotePdfResponse({
    supabase,
    quoteId: id,
    contactName: fullName,
    contactEmail: user.email ?? null,
    fallbackCompanyName: companyBranding.companyName,
  });
}
