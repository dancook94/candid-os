import type { SupabaseClient } from "@supabase/supabase-js";

function parseJobReferenceNumber(jobReference: string): number | null {
  const match = /^J-(\d+)$/.exec(jobReference.trim().toUpperCase());

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);

  return Number.isFinite(parsed) ? parsed : null;
}

/** Next J-{n} using the shared quote/job numbering space. */
export async function allocateNextJobNumber(adminClient: SupabaseClient): Promise<number> {
  const [{ data: jobs, error: jobsError }, { data: quotes, error: quotesError }] =
    await Promise.all([
      adminClient.from("jobs").select("job_reference"),
      adminClient.from("quotes").select("quote_number"),
    ]);

  if (jobsError) {
    throw jobsError;
  }

  if (quotesError) {
    throw quotesError;
  }

  let maxNumber = 0;

  for (const job of jobs ?? []) {
    const parsed = parseJobReferenceNumber(String(job.job_reference ?? ""));

    if (parsed !== null) {
      maxNumber = Math.max(maxNumber, parsed);
    }
  }

  for (const quote of quotes ?? []) {
    const quoteNumber = Number(quote.quote_number);

    if (Number.isFinite(quoteNumber)) {
      maxNumber = Math.max(maxNumber, quoteNumber);
    }
  }

  return maxNumber + 1;
}

export function buildJobReferenceFromNumber(jobNumber: number) {
  return `J-${jobNumber}`;
}

export async function isJobReferenceAvailable(
  adminClient: SupabaseClient,
  jobReference: string
) {
  const { data, error } = await adminClient
    .from("jobs")
    .select("id")
    .eq("job_reference", jobReference)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return !data;
}

export async function resolveInitialJobReferenceForQuote(
  adminClient: SupabaseClient,
  quoteNumber: number
) {
  const preferredReference = buildJobReferenceFromNumber(quoteNumber);
  const preferredAvailable = await isJobReferenceAvailable(
    adminClient,
    preferredReference
  );

  if (preferredAvailable) {
    return {
      jobReference: preferredReference,
      preferredReference,
      usedPreferred: true,
    };
  }

  const allocatedNumber = await allocateNextJobNumber(adminClient);

  return {
    jobReference: buildJobReferenceFromNumber(allocatedNumber),
    preferredReference,
    usedPreferred: false,
  };
}
