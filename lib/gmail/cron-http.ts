import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { sanitizeGmailError } from "@/lib/gmail/errors";

type AuthorizedWorker = {
  run: () => Promise<unknown>;
};

async function loadAuthorizedWorker(): Promise<AuthorizedWorker> {
  const [{ runGmailDiscoveryCron }, { createAdminClient }] = await Promise.all([
    import("@/lib/gmail/cron"),
    import("@/lib/supabase/admin"),
  ]);

  return {
    run: () => runGmailDiscoveryCron({ admin: createAdminClient() }),
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
