import { requirePurchasingPageAccess, purchaseOrderDetailPath, PURCHASING_DASHBOARD_PATH } from "@/lib/purchasing/access";
import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";
import { loadPurchaseOrderPdf } from "@/lib/purchasing/purchase-order-file";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  await requirePurchasingPageAccess(
    supabase,
    isPurchaseOrderSupplierId(id) ? purchaseOrderDetailPath(id) : PURCHASING_DASHBOARD_PATH
  );

  const result = await loadPurchaseOrderPdf(supabase, id);
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: result.status });
  }

  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
