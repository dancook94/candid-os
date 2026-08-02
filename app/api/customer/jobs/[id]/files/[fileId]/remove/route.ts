import { NextResponse } from "next/server";

import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { softDeleteCustomerArtworkFile } from "@/lib/jobs/upload-service";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    await softDeleteCustomerArtworkFile(jobContext, fileId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
