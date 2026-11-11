import type { SupabaseClient } from "@supabase/supabase-js";

export type InstallationReportPublicationEvent = {
  id: string;
  eventType: "published" | "unpublished" | "replaced";
  createdAt: string;
  reportReference: string;
  versionNumber: number;
  previousReportReference: string | null;
  actorName: string | null;
};

export async function listInstallationReportPublicationEvents(
  adminClient: SupabaseClient,
  visitId: string
): Promise<InstallationReportPublicationEvent[]> {
  const { data, error } = await adminClient
    .from("installation_completion_report_publication_events")
    .select(
      `
        id,
        event_type,
        created_at,
        previous_report_id,
        profiles!installation_completion_report_publication_events_actor_profile_id_fkey(full_name),
        installation_completion_reports(report_reference, version_number)
      `
    )
    .eq("installation_visit_id", visitId)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") {
      return [];
    }
    throw new Error(error.message);
  }

  const previousIds = (data ?? [])
    .map((row) => row.previous_report_id)
    .filter((value): value is string => typeof value === "string");
  const previousReferences = new Map<string, { reference: string; version: number }>();

  if (previousIds.length > 0) {
    const { data: previousReports } = await adminClient
      .from("installation_completion_reports")
      .select("id, report_reference, version_number")
      .in("id", previousIds);
    for (const row of previousReports ?? []) {
      previousReferences.set(String(row.id), {
        reference: String(row.report_reference),
        version: Number(row.version_number) || 0,
      });
    }
  }

  return (data ?? []).map((row) => {
    const report = Array.isArray(row.installation_completion_reports)
      ? row.installation_completion_reports[0]
      : row.installation_completion_reports;
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const previous =
      typeof row.previous_report_id === "string"
        ? previousReferences.get(row.previous_report_id)
        : null;
    return {
      id: String(row.id),
      eventType: row.event_type as InstallationReportPublicationEvent["eventType"],
      createdAt: String(row.created_at),
      reportReference: String(report && typeof report === "object" ? report.report_reference : "Report"),
      versionNumber: Number(report && typeof report === "object" ? report.version_number : 0) || 0,
      previousReportReference: previous ? `${previous.reference} (v${previous.version})` : null,
      actorName:
        profile && typeof profile === "object" && typeof profile.full_name === "string"
          ? profile.full_name
          : null,
    };
  });
}
