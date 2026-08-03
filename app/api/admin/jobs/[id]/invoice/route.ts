import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  approveInvoiceDraft,
  loadInvoiceReviewData,
  reconcileInvoiceDraft,
  updateInvoiceItem,
} from "@/lib/invoice/service";
import type { InvoiceItemUpdateInput } from "@/lib/invoice/types";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const adminClient = createAdminClient();

  try {
    const data = await loadInvoiceReviewData(adminClient, jobId, auth.userId);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to load invoice draft." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
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

  const adminClient = createAdminClient();
  const action = body.action ? String(body.action) : "reconcile";

  try {
    if (action === "approve") {
      const draftId = body.draftId ? String(body.draftId) : "";

      if (!draftId) {
        return NextResponse.json({ error: "Draft ID is required." }, { status: 400 });
      }

      const draft = await approveInvoiceDraft(adminClient, draftId, auth.userId);
      revalidatePath(`/admin/jobs/${jobId}/invoice`);
      revalidatePath(`/admin/jobs/${jobId}`);
      return NextResponse.json({ draft });
    }

    if (action === "update_item") {
      const itemId = body.itemId ? String(body.itemId) : "";

      if (!itemId) {
        return NextResponse.json({ error: "Item ID is required." }, { status: 400 });
      }

      const input: InvoiceItemUpdateInput = {
        description: body.description ? String(body.description) : undefined,
        quantity:
          body.quantity !== undefined && body.quantity !== null && body.quantity !== ""
            ? Number(body.quantity)
            : undefined,
        unit: body.unit ? String(body.unit) : undefined,
        unitPrice:
          body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== ""
            ? Number(body.unitPrice)
            : body.unitPrice === null
              ? null
              : undefined,
        taxRate:
          body.taxRate !== undefined && body.taxRate !== null && body.taxRate !== ""
            ? Number(body.taxRate)
            : undefined,
        billingStatus: body.billingStatus
          ? (String(body.billingStatus) as InvoiceItemUpdateInput["billingStatus"])
          : undefined,
        pricingSource: body.pricingSource
          ? (String(body.pricingSource) as InvoiceItemUpdateInput["pricingSource"])
          : undefined,
        pricingNote: body.pricingNote ? String(body.pricingNote) : undefined,
      };

      const item = await updateInvoiceItem(adminClient, itemId, input, auth.userId);
      revalidatePath(`/admin/jobs/${jobId}/invoice`);
      return NextResponse.json({ item });
    }

    const result = await reconcileInvoiceDraft(adminClient, jobId, auth.userId);
    revalidatePath(`/admin/jobs/${jobId}/invoice`);
    revalidatePath(`/admin/jobs/${jobId}`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to update invoice draft." },
      { status: 500 }
    );
  }
}
