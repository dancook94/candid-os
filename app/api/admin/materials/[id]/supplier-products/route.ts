import { NextResponse } from "next/server";

import { createSupplierProductRecord } from "@/lib/materials/actions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await createSupplierProductRecord(
    id,
    await request.json().catch(() => null)
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.id });
}
