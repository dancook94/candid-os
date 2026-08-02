import { NextResponse } from "next/server";

import { downloadDropboxFile } from "@/lib/dropbox/client";
import { loadCustomerOwnedJobFile, requireCustomerJobContext } from "@/lib/jobs/auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(
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
    const adminClient = createAdminClient();
    const file = await loadCustomerOwnedJobFile(adminClient, jobContext.job, fileId);

    if (file.upload_status !== "complete" || !file.dropbox_path_lower) {
      return NextResponse.json({ error: "File is not ready to download." }, { status: 409 });
    }

    const downloaded = await downloadDropboxFile(file.dropbox_path_lower);

    return new NextResponse(new Uint8Array(downloaded.buffer), {
      headers: {
        "Content-Type": downloaded.contentType,
        "Content-Disposition": `attachment; filename="${file.file_name}"`,
      },
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
