import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createJobFromPrintfactoryRecord } from "@/lib/jobs/create-from-printfactory";
import type { JobBillingType } from "@/lib/jobs/billing-types";
import {
  manuallyMatchPrintfactoryJob,
  ignorePrintfactoryJob,
  restoreIgnoredPrintfactoryJob,
  confirmSuggestedJobMatch,
  clearAutomaticJobMatch,
} from "@/lib/printfactory/job-matching";
import { rematchPrintfactoryJob } from "@/lib/printfactory/matching-service";
import {
  confirmPrintfactoryItemLink,
} from "@/lib/printfactory/readiness-service";
import {
  createProductionItemFromPrintfactoryJob,
} from "@/lib/printfactory/manifest-actions";
import {
  addLinkedCandidJob,
  assignPrintfactoryToCandidJobs,
  removeLinkedCandidJob,
} from "@/lib/printfactory/multi-job-links";
import {
  classifyReprintLink,
  detectPossibleReprintsForManifestItem,
  markPossibleReprintLink,
} from "@/lib/printfactory/reprint-detection";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type PrintfactoryJobActionBody = {
  action?: string;
  candidJobId?: string;
  candidJobIds?: string[];
  productionItemId?: string;
  productionItemIds?: string[];
  linkId?: string;
  reason?: string;
  classification?: string;
  title?: string;
  material?: string | null;
  machine?: string | null;
  billingType?: JobBillingType;
  projectName?: string;
  companyId?: string | null;
  requiredDate?: string | null;
  notes?: string | null;
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
        const candidJobIds =
          body.candidJobIds?.filter(Boolean) ??
          (body.candidJobId ? [body.candidJobId] : []);

        if (candidJobIds.length === 0) {
          return NextResponse.json({ error: "Candid job is required." }, { status: 400 });
        }

        const result = await assignPrintfactoryToCandidJobs(adminClient, {
          printfactoryJobId,
          candidJobIds,
          actorProfileId: auth.userId,
          linkJobs: manuallyMatchPrintfactoryJob,
        });

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        return NextResponse.json({ ok: true, row: result.row });
      }

      case "confirm_suggested_job": {
        const { data: pfJob, error: loadError } = await adminClient
          .from("printfactory_jobs")
          .select("suggested_candid_job_id")
          .eq("id", printfactoryJobId)
          .maybeSingle();

        if (loadError) {
          throw loadError;
        }

        const suggestedId =
          body.candidJobId ?? (pfJob?.suggested_candid_job_id as string | null);

        if (!suggestedId) {
          return NextResponse.json(
            { error: "No suggested Candid job to confirm." },
            { status: 400 }
          );
        }

        const row = await confirmSuggestedJobMatch(
          adminClient,
          printfactoryJobId,
          suggestedId,
          auth.userId
        );

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        return NextResponse.json({ ok: true, row });
      }

      case "clear_auto_match": {
        const row = await clearAutomaticJobMatch(adminClient, printfactoryJobId);
        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, row });
      }

      case "rematch": {
        const result = await rematchPrintfactoryJob(
          adminClient,
          printfactoryJobId,
          auth.userId
        );
        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        return NextResponse.json({ ok: true, ...result });
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
          const possible = await detectPossibleReprintsForManifestItem(
            adminClient,
            productionItemId,
            printfactoryJobId
          );

          const link = await confirmPrintfactoryItemLink(
            adminClient,
            printfactoryJobId,
            productionItemId,
            auth.userId
          );

          if (possible.length > 0 && link?.id) {
            await markPossibleReprintLink(adminClient, link.id as string, true);
          }

          links.push(link);
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

      case "create_job": {
        if (
          !body.billingType ||
          !body.projectName?.trim() ||
          !["billable", "non_billable", "internal"].includes(body.billingType)
        ) {
          return NextResponse.json(
            { error: "Job type and project name are required." },
            { status: 400 }
          );
        }

        const result = await createJobFromPrintfactoryRecord(adminClient, {
          printfactoryJobId,
          billingType: body.billingType,
          projectName: body.projectName.trim(),
          companyId: body.companyId ?? null,
          requiredDate: body.requiredDate ?? null,
          notes: body.notes ?? null,
          actorProfileId: auth.userId,
        });

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        revalidatePath("/admin/jobs");
        revalidatePath(`/admin/jobs/${result.job.id}`);
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

      case "restore": {
        const row = await restoreIgnoredPrintfactoryJob(
          adminClient,
          printfactoryJobId
        );

        revalidatePath("/admin/production/printfactory-unmatched");
        return NextResponse.json({ ok: true, row });
      }

      case "add_linked_job": {
        if (!body.candidJobId) {
          return NextResponse.json({ error: "Candid job is required." }, { status: 400 });
        }

        await addLinkedCandidJob(adminClient, {
          printfactoryJobId,
          candidJobId: body.candidJobId,
          actorProfileId: auth.userId,
        });

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        return NextResponse.json({ ok: true });
      }

      case "remove_linked_job": {
        if (!body.candidJobId) {
          return NextResponse.json({ error: "Candid job is required." }, { status: 400 });
        }

        await removeLinkedCandidJob(adminClient, {
          printfactoryJobId,
          candidJobId: body.candidJobId,
          actorProfileId: auth.userId,
        });

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/production");
        return NextResponse.json({ ok: true });
      }

      case "classify_reprint": {
        if (!body.linkId || !body.classification || !body.reason?.trim()) {
          return NextResponse.json(
            { error: "Link, classification, and reason are required." },
            { status: 400 }
          );
        }

        const row = await classifyReprintLink(adminClient, {
          linkId: body.linkId,
          classification: body.classification as
            | "production_retry_no_charge"
            | "customer_reprint_billable"
            | "replacement"
            | "additional_quantity"
            | "ignored",
          reason: body.reason,
          actorProfileId: auth.userId,
        });

        revalidatePath("/admin/production/printfactory-unmatched");
        revalidatePath("/admin/jobs");
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
