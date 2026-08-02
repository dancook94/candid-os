import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  validateActiveContactForCompany,
  validateQuoteContactAgainstOpportunity,
} from "@/lib/crm/contact-validation";
import { createClient } from "@/lib/supabase/server";

type ValidateBody = {
  contactId?: string;
  companyId?: string;
  opportunityId?: string | null;
  required?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: ValidateBody;

  try {
    body = (await request.json()) as ValidateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const contactValidation = await validateActiveContactForCompany(
    supabase,
    body.contactId,
    body.companyId,
    { required: body.required ?? true }
  );

  if (!contactValidation.ok) {
    return NextResponse.json({ error: contactValidation.message }, { status: 400 });
  }

  if (body.contactId && body.opportunityId) {
    const opportunityValidation = await validateQuoteContactAgainstOpportunity(
      supabase,
      body.contactId,
      body.opportunityId
    );

    if (!opportunityValidation.ok) {
      return NextResponse.json(
        { error: opportunityValidation.message },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true, contact: contactValidation.contact });
}
