import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { updateJobArtworkSource } from "@/lib/jobs/update-artwork-source";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id: jobId } = await context.params;
    const supabase = await createClient();
    const authResult = await verifyApprovedAdmin(supabase);

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status }
      );
    }

    const body = (await request.json()) as { artworkSource?: string };

    if (!body.artworkSource?.trim()) {
      return NextResponse.json({ error: "Artwork source is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const result = await updateJobArtworkSource(adminClient, {
      jobId,
      artworkSource: body.artworkSource.trim(),
      actorProfileId: authResult.userId,
    });

    return NextResponse.json({
      ok: true,
      updated: result.updated,
      artworkSource: result.artworkSource,
      previousArtworkSource: result.previousArtworkSource,
      status: result.job.status,
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
