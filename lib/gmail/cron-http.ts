import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { sanitizeGmailError } from "@/lib/gmail/errors";

type AuthorizedWorker = {
  run: () => Promise<unknown>;
};

async function loadAuthorizedWorker(): Promise<AuthorizedWorker> {
  const [{ runGmailDiscoveryCron }, { createAdminClient }, { peekInvoiceProcessing }, { shouldAdvanceProcessing }] =
    await Promise.all([
      import("@/lib/gmail/cron"),
      import("@/lib/supabase/admin"),
      import("@/lib/materials/invoices/processing-store"),
      import("@/lib/materials/invoices/processing-run"),
    ]);

  return {
    run: async () => {
      const admin = createAdminClient();
      const discovery = await runGmailDiscoveryCron({ admin });
      const peek = await peekInvoiceProcessing(admin).catch(() => ({ action: "unavailable" as const }));

      if (!shouldAdvanceProcessing(discovery, peek)) {
        return {
          ...discovery,
          processing: peek.action === "process" ? { status: "deferred" as const } : { status: peek.action },
        };
      }

      const { advanceStoredInvoiceProcessing } = await import("@/lib/materials/invoices/processing-tick");
      return { ...discovery, processing: await advanceStoredInvoiceProcessing(admin) };
    },
  };
}

export async function handleGmailDiscoveryCron(
  request: Request,
  loadWorker: () => Promise<AuthorizedWorker> = loadAuthorizedWorker
) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  if (!cronAuthorizationMatches(request.headers.get("authorization"), cronSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const worker = await loadWorker();
    return Response.json(await worker.run());
  } catch (error) {
    return Response.json(
      { ok: false, needsAttention: true, error: sanitizeGmailError(error) },
      { status: 200 }
    );
  }
}
