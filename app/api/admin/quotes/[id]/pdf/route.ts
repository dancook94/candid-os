import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createQuotePdfResponse } from "@/lib/quotes/quote-pdf-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }

  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version");
  const versionNumber = versionParam ? Number.parseInt(versionParam, 10) : undefined;

  if (versionParam && (!versionNumber || Number.isNaN(versionNumber))) {
    return Response.json({ error: "Invalid version number." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: quote } = await adminClient
    .from("quotes")
    .select("id, contact_id, company_id, companies(company_name), contacts(full_name, email)")
    .eq("id", id)
    .maybeSingle();

  if (!quote) {
    return Response.json({ error: "Quote not found." }, { status: 404 });
  }

  const company = Array.isArray(quote.companies) ? quote.companies[0] : quote.companies;
  const contact = Array.isArray(quote.contacts) ? quote.contacts[0] : quote.contacts;

  return createQuotePdfResponse({
    supabase: adminClient,
    quoteId: id,
    contactName: (contact?.full_name as string | undefined) ?? "Customer",
    contactEmail: (contact?.email as string | null | undefined) ?? null,
    fallbackCompanyName:
      (company?.company_name as string | undefined) ?? "Customer company",
    versionNumber,
    allowDraftVersion: true,
  });
}
