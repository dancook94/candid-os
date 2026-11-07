import { NextResponse } from "next/server";

import { parseApprovedImportCatalogVersion } from "@/lib/materials/import-batches";
import {
  commitInitialMaterialImport,
  previewInitialMaterialImport,
} from "@/lib/materials/initial-import";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    mode?: string;
    confirmation?: string;
    catalogVersion?: string;
  } | null;

  const catalogVersion = parseApprovedImportCatalogVersion(
    body?.catalogVersion
  );

  if (!catalogVersion) {
    return NextResponse.json(
      {
        error:
          "Choose batch 1 (initial-approved-46) or batch 2 (medium-approved-batch-2).",
      },
      { status: 400 }
    );
  }

  if (body?.mode === "commit") {
    const result = await commitInitialMaterialImport(
      body.confirmation,
      catalogVersion
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, plan: result.plan ?? null },
        { status: result.status }
      );
    }

    return NextResponse.json({ result: result.result, plan: result.plan });
  }

  const preview = await previewInitialMaterialImport(catalogVersion);

  if (!preview.ok) {
    return NextResponse.json({ error: preview.error }, { status: preview.status });
  }

  return NextResponse.json({ plan: preview.plan });
}
