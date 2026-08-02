import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { retryDropboxSetupForJob } from "@/lib/jobs/create-from-quote";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const authResult = await verifyApprovedAdmin(supabase);

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status }
      );
    }

    const result = await retryDropboxSetupForJob(id);

    revalidateJobPages({
      jobId: id,
      quoteId: result.job.quote_id,
      opportunityId: result.job.opportunity_id,
    });

    return NextResponse.json({
      success: result.dropboxReady,
      dropboxReady: result.dropboxReady,
      dropboxSetupStatus: result.job.dropbox_setup_status,
      dropboxFolderPath: result.job.dropbox_folder_path,
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
