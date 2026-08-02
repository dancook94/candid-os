import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { fetchActiveCompanyContacts } from "@/lib/crm/company-contact-options";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!companyId?.trim()) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  try {
    const contacts = await fetchActiveCompanyContacts(supabase, companyId);
    return NextResponse.json({ contacts });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load contacts.",
      },
      { status: 400 }
    );
  }
}
