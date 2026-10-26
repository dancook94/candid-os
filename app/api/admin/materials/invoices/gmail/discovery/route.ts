import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { checkGmailConnection } from "@/lib/gmail/connection";
import { sanitizeGmailError } from "@/lib/gmail/errors";
import {
  retryFailedGmailItems,
  setGmailDiscoveryPaused,
  startGmailDiscovery,
  stepGmailDiscovery,
} from "@/lib/gmail/discovery";
import { previewGmailDiscovery } from "@/lib/gmail/preview";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json()) as {
    action?: string;
    dateFrom?: string;
    dateTo?: string;
    preset?: string;
  };

  try {
    if (body.action === "preview") {
      return NextResponse.json(
        await previewGmailDiscovery({
          dateFrom: body.dateFrom,
          dateTo: body.dateTo,
          preset: body.preset === "historical" ? "historical" : undefined,
        })
      );
    }

    const admin = createAdminClient();

    switch (body.action) {
      case "health":
        await checkGmailConnection(admin);
        return NextResponse.json({ ok: true });
      case "start":
        return NextResponse.json(
          await startGmailDiscovery({
            admin,
            userId: auth.userId,
            dateFrom: body.dateFrom,
            dateTo: body.dateTo,
          })
        );
      case "step":
        return NextResponse.json(await stepGmailDiscovery({ admin }));
      case "pause":
        await setGmailDiscoveryPaused(admin, true);
        return NextResponse.json({ ok: true, status: "paused" });
      case "resume":
        await setGmailDiscoveryPaused(admin, false);
        return NextResponse.json({ ok: true, status: "running" });
      case "retry":
        return NextResponse.json(await retryFailedGmailItems(admin));
      default:
        return NextResponse.json({ error: "Unknown discovery action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: sanitizeGmailError(error) }, { status: 400 });
  }
}
