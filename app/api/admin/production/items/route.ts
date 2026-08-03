import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { ProductionError } from "@/lib/production/errors";
import {
  archiveProductionItem,
  createProductionItem,
  duplicateProductionItem,
  updateProductionItem,
} from "@/lib/production/service";
import type { ProductionItemFormInput } from "@/lib/production/types";
import type { ProductionPriority, ProductionSides, ProductionStatus } from "@/lib/production/constants";
import { isValidProductionStatus } from "@/lib/production/status-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function parseFormBody(body: Record<string, unknown>): ProductionItemFormInput {
  const productionStatus = body.productionStatus;

  return {
    itemName: String(body.itemName ?? ""),
    description: body.description ? String(body.description) : null,
    quantity: body.quantity !== undefined && body.quantity !== null && body.quantity !== ""
      ? Number(body.quantity)
      : null,
    requiredAt: body.requiredAt ? String(body.requiredAt) : null,
    priority: (body.priority as ProductionPriority) ?? "normal",
    machine: body.machine ? String(body.machine) : null,
    material: body.material ? String(body.material) : null,
    mediaProfile: body.mediaProfile ? String(body.mediaProfile) : null,
    widthMm:
      body.widthMm !== undefined && body.widthMm !== null && body.widthMm !== ""
        ? Number(body.widthMm)
        : null,
    heightMm:
      body.heightMm !== undefined && body.heightMm !== null && body.heightMm !== ""
        ? Number(body.heightMm)
        : null,
    copies:
      body.copies !== undefined && body.copies !== null && body.copies !== ""
        ? Number(body.copies)
        : null,
    sides: (body.sides as ProductionSides) || null,
    finishingNotes: body.finishingNotes ? String(body.finishingNotes) : null,
    assignedToProfileId: body.assignedToProfileId
      ? String(body.assignedToProfileId)
      : null,
    productionStatus:
      productionStatus && isValidProductionStatus(String(productionStatus))
        ? (String(productionStatus) as ProductionStatus)
        : undefined,
    synologySourcePath: body.synologySourcePath
      ? String(body.synologySourcePath)
      : null,
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
    const item = await createProductionItem(
      adminClient,
      jobId,
      parseFormBody(body),
      auth.userId
    );

    revalidatePath("/admin/production");
    revalidatePath(`/admin/jobs/${jobId}`);

    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to create production item." },
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
    if (action === "archive") {
      await archiveProductionItem(adminClient, itemId, auth.userId);
    } else if (action === "duplicate") {
      const item = await duplicateProductionItem(adminClient, itemId, auth.userId);
      revalidatePath("/admin/production");
      revalidatePath("/admin/jobs");
      return NextResponse.json({ item });
    } else {
      const item = await updateProductionItem(
        adminClient,
        itemId,
        parseFormBody(body),
        auth.userId
      );
      revalidatePath("/admin/production");
      revalidatePath(`/admin/jobs/${item.job_id}`);
      return NextResponse.json({ item });
    }

    revalidatePath("/admin/production");
    revalidatePath("/admin/jobs");

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to update production item." },
      { status: 500 }
    );
  }
}
