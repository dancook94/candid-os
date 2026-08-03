import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  bulkClearAutomaticMatches,
  bulkConfirmHighConfidenceJobSuggestions,
  bulkIgnoreHistoricalPrintfactoryJobs,
  bulkRematchPrintfactoryJobs,
} from "@/lib/printfactory/matching-service";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type BulkActionBody = {
  action?: string;
  printfactoryJobIds?: string[];
  cutoffDate?: string;
  confirm?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: BulkActionBody;

  try {
    body = (await request.json()) as BulkActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Bulk actions require confirm: true." },
      { status: 400 }
    );
  }

  const ids = body.printfactoryJobIds ?? [];
  const adminClient = createAdminClient();

  try {
    switch (body.action) {
      case "confirm_high_confidence_suggestions": {
        const result = await bulkConfirmHighConfidenceJobSuggestions(
          adminClient,
          auth.userId
        );
        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, ...result });
      }

      case "ignore_historical": {
        if (ids.length === 0) {
          return NextResponse.json(
            { error: "Select PrintFactory records to ignore." },
            { status: 400 }
          );
        }

        const result = await bulkIgnoreHistoricalPrintfactoryJobs(
          adminClient,
          ids,
          auth.userId,
          body.cutoffDate ?? null
        );
        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, ...result });
      }

      case "rematch": {
        if (ids.length === 0) {
          return NextResponse.json(
            { error: "Select PrintFactory records to re-match." },
            { status: 400 }
          );
        }

        const result = await bulkRematchPrintfactoryJobs(
          adminClient,
          ids,
          auth.userId
        );
        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        return NextResponse.json({ ok: true, ...result });
      }

      case "clear_automatic_matches": {
        if (ids.length === 0) {
          return NextResponse.json(
            { error: "Select PrintFactory records to clear." },
            { status: 400 }
          );
        }

        const result = await bulkClearAutomaticMatches(adminClient, ids);
        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, ...result });
      }

      default:
        return NextResponse.json({ error: "Unknown bulk action." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk action failed." },
      { status: 500 }
    );
  }
}
