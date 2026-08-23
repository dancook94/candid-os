import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  addManifestItem,
  cancelManifestItemByCustomer,
  duplicateManifestItem,
  reclassifyManifestItem,
  updateManifestItem,
} from "@/lib/manifest/service";
import { updateManifestItemProofRequirement } from "@/lib/manifest/proof-requirement-service";
import type { ManifestItemFormInput } from "@/lib/manifest/types";
import type { ManifestSourceType } from "@/lib/manifest/constants";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function parseManifestForm(body: Record<string, unknown>): ManifestItemFormInput & {
  sourceType?: ManifestSourceType;
} {
  return {
    itemName: String(body.itemName ?? ""),
    description: body.description ? String(body.description) : null,
    quantity:
      body.quantity !== undefined && body.quantity !== null && body.quantity !== ""
        ? Number(body.quantity)
        : null,
    unit: body.unit ? String(body.unit) : null,
    material: body.material ? String(body.material) : null,
    machine: body.machine ? String(body.machine) : null,
    widthMm:
      body.widthMm !== undefined && body.widthMm !== null && body.widthMm !== ""
        ? Number(body.widthMm)
        : null,
    heightMm:
      body.heightMm !== undefined && body.heightMm !== null && body.heightMm !== ""
        ? Number(body.heightMm)
        : null,
    internalNote: body.internalNote ? String(body.internalNote) : null,
    sourceType: body.sourceType ? (String(body.sourceType) as ManifestSourceType) : undefined,
    billingStatus: body.billingStatus
      ? (String(body.billingStatus) as ManifestItemFormInput["billingStatus"])
      : undefined,
    productionRequirementStatus: body.productionRequirementStatus
      ? (String(
          body.productionRequirementStatus
        ) as ManifestItemFormInput["productionRequirementStatus"])
      : undefined,
    requiresPrintfactory: body.requiresPrintfactory === true,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const jobId = body.jobId ? String(body.jobId) : "";

  if (!jobId) {
    return NextResponse.json({ error: "Job ID is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const item = await addManifestItem(
      adminClient,
      jobId,
      parseManifestForm(body),
      auth.userId
    );

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/production");

    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to add manifest item." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const itemId = body.itemId ? String(body.itemId) : "";
  const action = body.action ? String(body.action) : "update";

  if (!itemId) {
    return NextResponse.json({ error: "Item ID is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    if (action === "cancel_customer") {
      const reason = body.reason ? String(body.reason) : "";

      if (!reason.trim()) {
        return NextResponse.json({ error: "Cancellation reason is required." }, { status: 400 });
      }

      const item = await cancelManifestItemByCustomer(
        adminClient,
        itemId,
        {
          reason,
          effectiveAt: body.effectiveAt ? String(body.effectiveAt) : undefined,
        },
        auth.userId
      );

      revalidatePath(`/admin/jobs/${item.job_id}`);
      return NextResponse.json({ item });
    }

    if (action === "duplicate") {
      const item = await duplicateManifestItem(adminClient, itemId, auth.userId);
      revalidatePath(`/admin/jobs/${item.job_id}`);
      return NextResponse.json({ item });
    }

    if (
      action === "mark_not_required" ||
      action === "mark_external" ||
      action === "mark_manual_production" ||
      action === "mark_no_charge_reprint" ||
      action === "combine" ||
      action === "archive" ||
      action === "requires_printfactory" ||
      action === "no_printfactory" ||
      action === "set_proof_requirement"
    ) {
      if (action === "set_proof_requirement") {
        const proofRequirement = body.proofRequirement ? String(body.proofRequirement) : "";
        if (!proofRequirement) {
          return NextResponse.json(
            { error: "proofRequirement is required." },
            { status: 400 }
          );
        }

        const item = await updateManifestItemProofRequirement(adminClient, {
          itemId,
          proofRequirement,
          actorProfileId: auth.userId,
        });

        revalidatePath(`/admin/jobs/${item.job_id}`);
        return NextResponse.json({ item });
      }

      const item = await reclassifyManifestItem(
        adminClient,
        itemId,
        action,
        auth.userId,
        {
          combineIntoItemId: body.combineIntoItemId
            ? String(body.combineIntoItemId)
            : undefined,
          reason: body.reason ? String(body.reason) : undefined,
        }
      );

      revalidatePath(`/admin/jobs/${item.job_id}`);
      return NextResponse.json({ item });
    }

    const item = await updateManifestItem(
      adminClient,
      itemId,
      parseManifestForm(body),
      auth.userId
    );

    revalidatePath(`/admin/jobs/${item.job_id}`);
    revalidatePath("/admin/production");

    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to update manifest item." },
      { status: 500 }
    );
  }
}
