import { NextResponse } from "next/server";

import { createMaterialRecord } from "@/lib/materials/actions";

export async function POST(request: Request) {
  const result = await createMaterialRecord(await request.json().catch(() => null));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.id });
}
