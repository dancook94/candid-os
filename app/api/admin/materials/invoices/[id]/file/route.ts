import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { SUPPLIER_INVOICE_FILES_BUCKET } from "@/lib/materials/invoices/model";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { data: file, error } = await supabase
    .from("supplier_invoice_files")
    .select("storage_path, original_filename, mime_type")
    .eq("invoice_id", id)
    .maybeSingle();

  if (error || !file) {
    return NextResponse.json({ error: "Invoice file not found." }, { status: 404 });
  }

  const downloaded = await supabase.storage
    .from(SUPPLIER_INVOICE_FILES_BUCKET)
    .download(file.storage_path);

  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ error: "Invoice file could not be opened." }, { status: 404 });
  }

  const bytes = await downloaded.data.arrayBuffer();

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": file.mime_type,
      "Content-Disposition": `inline; filename="${file.original_filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
