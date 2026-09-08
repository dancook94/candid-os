import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import { resendStaffInvite } from "@/lib/staff-auth-actions";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: staffId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  const requestUrl = new URL(request.url);
  const result = await resendStaffInvite(staffId, requestUrl.origin);

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    message: result.message,
  });
}
