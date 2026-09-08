import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  fetchPrintfactoryJobThumbnail,
  PRINTFACTORY_THUMBNAIL_DEFAULT_PAGE,
} from "@/lib/printfactory/thumbnail";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ guid: string }>;
};

function parsePage(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return PRINTFACTORY_THUMBNAIL_DEFAULT_PAGE;
  }

  return parsed;
}

export async function GET(request: Request, context: RouteContext) {
  const { guid } = await context.params;
  const jobGuid = guid?.trim();

  if (!jobGuid) {
    return NextResponse.json({ error: "Job GUID is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const page = parsePage(searchParams.get("page"));

  try {
    const thumbnail = await fetchPrintfactoryJobThumbnail(jobGuid, page);

    if (!thumbnail) {
      return NextResponse.json({ error: "Preview unavailable." }, { status: 404 });
    }

    return new NextResponse(thumbnail.body, {
      status: 200,
      headers: {
        "Content-Type": thumbnail.contentType,
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    if (error instanceof PrintfactoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 502 });
    }

    return NextResponse.json(
      { error: "Unable to load PrintFactory preview." },
      { status: 502 }
    );
  }
}
