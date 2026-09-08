import type { SupabaseClient } from "@supabase/supabase-js";

import { ProductionError } from "@/lib/production/errors";
import { refreshJobProductionReadiness } from "@/lib/printfactory/readiness-service";

export async function listLinkedCandidJobs(
  adminClient: SupabaseClient,
  printfactoryJobId: string
) {
  const { data, error } = await adminClient
    .from("printfactory_job_candid_jobs")
    .select(
      "id, candid_job_id, link_type, is_primary, linked_at, jobs(id, job_reference, project_name, companies(company_name))"
    )
    .eq("printfactory_job_id", printfactoryJobId)
    .order("is_primary", { ascending: false });

  if (error) {
    if (error.code === "42P01") {
      return [];
    }

    throw new ProductionError(error.message, 500);
  }

  return data ?? [];
}

export async function assignPrintfactoryToCandidJobs(
  adminClient: SupabaseClient,
  input: {
    printfactoryJobId: string;
    candidJobIds: string[];
    actorProfileId: string;
    linkJobs: (
      adminClient: SupabaseClient,
      printfactoryJobId: string,
      candidJobId: string,
      actorProfileId: string
    ) => Promise<unknown>;
  }
) {
  const uniqueIds = [...new Set(input.candidJobIds.map((id) => id.trim()).filter(Boolean))];

  if (uniqueIds.length === 0) {
    throw new ProductionError("At least one Candid job is required.", 400);
  }

  let lastRow: unknown = null;

  for (const candidJobId of uniqueIds) {
    lastRow = await input.linkJobs(
      adminClient,
      input.printfactoryJobId,
      candidJobId,
      input.actorProfileId
    );
  }

  return { ok: true as const, row: lastRow };
}

export async function upsertPrintfactoryCandidJobLink(
  adminClient: SupabaseClient,
  input: {
    printfactoryJobId: string;
    candidJobId: string;
    actorProfileId: string;
    linkType?: "manual" | "confirmed_multi";
    isPrimary?: boolean;
  }
) {
  const { error: linkError } = await adminClient.from("printfactory_job_candid_jobs").upsert(
    {
      printfactory_job_id: input.printfactoryJobId,
      candid_job_id: input.candidJobId,
      link_type: input.linkType ?? "manual",
      is_primary: input.isPrimary ?? false,
      linked_by_profile_id: input.actorProfileId,
    },
    { onConflict: "printfactory_job_id,candid_job_id" }
  );

  if (linkError) {
    if (linkError.code === "42P01") {
      throw new ProductionError(
        "Multi-job linking requires migration 20260822120000_production_board_multi_job.sql.",
        503
      );
    }

    throw new ProductionError(linkError.message, 500);
  }
}

export async function addLinkedCandidJob(
  adminClient: SupabaseClient,
  input: {
    printfactoryJobId: string;
    candidJobId: string;
    actorProfileId: string;
    linkType?: "manual" | "confirmed_multi";
  }
) {
  const { data: pfJob, error: pfError } = await adminClient
    .from("printfactory_jobs")
    .select("id, candid_job_id, is_multi_job_sheet")
    .eq("id", input.printfactoryJobId)
    .maybeSingle();

  if (pfError || !pfJob) {
    throw new ProductionError(pfError?.message ?? "PrintFactory job not found.", 404);
  }

  await upsertPrintfactoryCandidJobLink(adminClient, {
    printfactoryJobId: input.printfactoryJobId,
    candidJobId: input.candidJobId,
    actorProfileId: input.actorProfileId,
    linkType: input.linkType,
    isPrimary: !pfJob.candid_job_id,
  });

  const { data: remaining } = await adminClient
    .from("printfactory_job_candid_jobs")
    .select("candid_job_id")
    .eq("printfactory_job_id", input.printfactoryJobId);

  const linkCount = remaining?.length ?? 0;

  const updates: Record<string, unknown> = {
    is_multi_job_sheet: linkCount > 1,
  };

  if (!pfJob.candid_job_id) {
    updates.candid_job_id = input.candidJobId;
    updates.job_match_status = "matched_manually";
    updates.job_match_method = "manual";
  }

  await adminClient.from("printfactory_jobs").update(updates).eq("id", input.printfactoryJobId);

  await refreshJobProductionReadiness(adminClient, input.candidJobId, input.actorProfileId);

  return { ok: true as const };
}

export async function removeLinkedCandidJob(
  adminClient: SupabaseClient,
  input: {
    printfactoryJobId: string;
    candidJobId: string;
    actorProfileId: string;
  }
) {
  const { error } = await adminClient
    .from("printfactory_job_candid_jobs")
    .delete()
    .eq("printfactory_job_id", input.printfactoryJobId)
    .eq("candid_job_id", input.candidJobId);

  if (error) {
    if (error.code === "42P01") {
      throw new ProductionError("Multi-job linking table not available.", 503);
    }

    throw new ProductionError(error.message, 500);
  }

  const { data: remaining } = await adminClient
    .from("printfactory_job_candid_jobs")
    .select("candid_job_id, is_primary")
    .eq("printfactory_job_id", input.printfactoryJobId);

  const links = remaining ?? [];
  const isMulti = links.length > 1;

  let primaryJobId = links.find((link) => link.is_primary)?.candid_job_id as string | undefined;

  if (!primaryJobId && links.length > 0) {
    primaryJobId = links[0].candid_job_id as string;
  }

  await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: primaryJobId ?? null,
      is_multi_job_sheet: isMulti,
      ...(links.length === 0
        ? { job_match_status: "unmatched", job_match_method: null }
        : {}),
    })
    .eq("id", input.printfactoryJobId);

  await refreshJobProductionReadiness(adminClient, input.candidJobId, input.actorProfileId);

  return { ok: true as const };
}

export async function syncMultiJobLinksFromReferences(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  candidJobIds: string[],
  linkType: "automatic" | "confirmed_multi" = "automatic"
) {
  if (candidJobIds.length === 0) {
    return;
  }

  const uniqueIds = [...new Set(candidJobIds)];

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const candidJobId = uniqueIds[index];

    await adminClient.from("printfactory_job_candid_jobs").upsert(
      {
        printfactory_job_id: printfactoryJobId,
        candid_job_id: candidJobId,
        link_type: linkType,
        is_primary: index === 0,
      },
      { onConflict: "printfactory_job_id,candid_job_id" }
    );
  }

  await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: uniqueIds[0],
      is_multi_job_sheet: uniqueIds.length > 1,
    })
    .eq("id", printfactoryJobId);
}

export async function countPrintfactoryFilesForJob(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { count: primaryCount, error: primaryError } = await adminClient
    .from("printfactory_jobs")
    .select("id", { count: "exact", head: true })
    .eq("candid_job_id", jobId)
    .in("job_match_status", ["matched_automatically", "matched_manually"]);

  if (primaryError && primaryError.code !== "42P01") {
    return 0;
  }

  let linkedCount = 0;

  const { count, error: linkedError } = await adminClient
    .from("printfactory_job_candid_jobs")
    .select("id", { count: "exact", head: true })
    .eq("candid_job_id", jobId);

  if (!linkedError) {
    linkedCount = count ?? 0;
  }

  return Math.max(primaryCount ?? 0, linkedCount);
}
