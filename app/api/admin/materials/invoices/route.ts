import { NextResponse } from "next/server";

import { uploadSupplierInvoice } from "@/lib/materials/invoices/actions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an invoice file." }, { status: 400 });
  }

  const result = await uploadSupplierInvoice(file);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}
