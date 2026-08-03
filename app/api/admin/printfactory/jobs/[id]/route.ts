import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  manuallyMatchPrintfactoryJob,
  ignorePrintfactoryJob,
} from "@/lib/printfactory/job-matching";
import {
  confirmPrintfactoryItemLink,
} from "@/lib/printfactory/readiness-service";
import {
  createProductionItemFromPrintfactoryJob,
} from "@/lib/printfactory/manifest-actions";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type PrintfactoryJobActionBody = {
  action?: string;
  candidJobId?: string;
  productionItemId?: string;
  productionItemIds?: string[];
  reason?: string;
  classification?: string;
  title?: string;
  material?: string | null;
  machine?: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: printfactoryJobId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: PrintfactoryJobActionBody;

  try {
    body = (await request.json()) as PrintfactoryJobActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    switch (body.action) {
      case "match_job": {
        if (!body.candidJobId) {
          return NextResponse.json({ error: "Candid job is required." }, { status: 400 });
        }

        const row = await manuallyMatchPrintfactoryJob(
          adminClient,
          printfactoryJobId,
          body.candidJobId,
          auth.userId
        );

        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, row });
      }

      case "confirm_item": {
        const itemIds =
          body.productionItemIds ??
          (body.productionItemId ? [body.productionItemId] : []);

        if (itemIds.length === 0) {
          return NextResponse.json({ error: "Manifest item is required." }, { status: 400 });
        }

        const links = [];

        for (const productionItemId of itemIds) {
          links.push(
            await confirmPrintfactoryItemLink(
              adminClient,
              printfactoryJobId,
              productionItemId,
              auth.userId
            )
          );
        }

        revalidatePath("/admin/production");
        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, links });
      }

      case "create_additional_item": {
        const result = await createProductionItemFromPrintfactoryJob(
          adminClient,
          printfactoryJobId,
          {
            classification:
              (body.classification as
                | "additional_billable"
                | "replacement"
                | "no_charge_reprint"
                | "internal_test"
                | "ignore") ?? "additional_billable",
            title: body.title,
            material: body.material,
            machine: body.machine,
          },
          auth.userId
        );

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/jobs");
        return NextResponse.json({ ok: true, ...result });
      }

      case "ignore": {
        if (!body.reason?.trim()) {
          return NextResponse.json({ error: "Reason is required." }, { status: 400 });
        }

        const row = await ignorePrintfactoryJob(
          adminClient,
          printfactoryJobId,
          body.reason.trim(),
          auth.userId
        );

        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, row });
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed." },
      { status: 500 }
    );
  }
}
