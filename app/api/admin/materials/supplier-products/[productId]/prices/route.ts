import { NextResponse } from "next/server";

import { createApprovedPriceRecord } from "@/lib/materials/actions";

type RouteContext = {
  params: Promise<{ productId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { productId } = await context.params;
  const result = await createApprovedPriceRecord(
    productId,
    await request.json().catch(() => null)
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.id });
}
