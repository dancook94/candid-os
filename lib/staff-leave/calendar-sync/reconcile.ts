import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildSicknessCalendarEvent,
  buildTeamLeaveCalendarEvent,
} from "@/lib/staff-leave/calendar-sync/build-event";
import { londonTodayIso } from "@/lib/staff-leave/calendar";
import { mappingNeedsGoogleResync } from "@/lib/staff-leave/calendar-sync/mapping-transition";

export type CalendarReconciliationFindingKind =
  | "missing_team_leave_mapping"
  | "outdated_team_leave_mapping"
  | "retained_cancelled_leave_mapping"
  | "missing_sickness_mapping"
  | "outdated_sickness_mapping"
  | "mock_needs_google_sync";

export type CalendarReconciliationFinding = {
  kind: CalendarReconciliationFindingKind;
  entityType: "leave_request" | "sickness";
  entityId: string;
  leaveRequestId?: string;
  sicknessId?: string;
  detail?: string;
};

export type CalendarReconciliationScanResult = {
  londonToday: string;
  findings: CalendarReconciliationFinding[];
  summary: Record<CalendarReconciliationFindingKind, number>;
};

export type CalendarReconciliationEnqueueResult = {
  dryRun: boolean;
  enqueued: number;
  skipped: number;
  findings: CalendarReconciliationFinding[];
};

type LeaveRow = {
  id: string;
  profile_id: string;
  status: string;
  leave_kind: string;
  start_date: string;
  end_date: string;
  day_portion: string;
};

type MappingRow = {
  entity_id: string;
  entity_type: string;
  sync_provider: string;
  content_fingerprint: string;
  deleted_at: string | null;
};

type SicknessRow = {
  id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  day_portion: string;
};

function emptySummary(): Record<CalendarReconciliationFindingKind, number> {
  return {
    missing_team_leave_mapping: 0,
    outdated_team_leave_mapping: 0,
    retained_cancelled_leave_mapping: 0,
    missing_sickness_mapping: 0,
    outdated_sickness_mapping: 0,
    mock_needs_google_sync: 0,
  };
}

function recordFinding(
  findings: CalendarReconciliationFinding[],
  summary: Record<CalendarReconciliationFindingKind, number>,
  finding: CalendarReconciliationFinding
) {
  findings.push(finding);
  summary[finding.kind] += 1;
}

export async function scanStaffLeaveCalendarReconciliation(
  adminClient: SupabaseClient,
  input?: { targetGoogleProvider?: boolean }
): Promise<CalendarReconciliationScanResult> {
  const londonToday = londonTodayIso();
  const findings: CalendarReconciliationFinding[] = [];
  const summary = emptySummary();

  const { data: approvedLeave, error: leaveError } = await adminClient
    .from("staff_leave_requests")
    .select("id, profile_id, status, leave_kind, start_date, end_date, day_portion")
    .eq("status", "approved")
    .in("leave_kind", ["annual", "additional_paid"])
    .gte("end_date", londonToday);

  if (leaveError) {
    throw leaveError;
  }

  const { data: cancelledLeave, error: cancelledError } = await adminClient
    .from("staff_leave_requests")
    .select("id, profile_id, status, leave_kind, start_date, end_date, day_portion")
    .eq("status", "cancelled")
    .in("leave_kind", ["annual", "additional_paid"])
    .gte("end_date", londonToday);

  if (cancelledError) {
    throw cancelledError;
  }

  const { data: sicknessRows, error: sicknessError } = await adminClient
    .from("staff_absence_sickness")
    .select("id, profile_id, start_date, end_date, day_portion")
    .gte("end_date", londonToday);

  if (sicknessError) {
    throw sicknessError;
  }

  const { data: mappings, error: mappingError } = await adminClient
    .from("staff_leave_calendar_event_mappings")
    .select("entity_id, entity_type, sync_provider, content_fingerprint, deleted_at");

  if (mappingError) {
    if (mappingError.code === "42P01" || mappingError.code === "PGRST205") {
      return { londonToday, findings: [], summary: emptySummary() };
    }

    throw mappingError;
  }

  const mappingByEntity = new Map<string, MappingRow>();
  for (const row of mappings ?? []) {
    mappingByEntity.set(`${row.entity_type}:${row.entity_id}`, row as MappingRow);
  }

  const profileIds = new Set<string>();
  for (const row of approvedLeave ?? []) {
    profileIds.add(row.profile_id);
  }
  for (const row of sicknessRows ?? []) {
    profileIds.add(row.profile_id);
  }

  const profileNames = await loadProfileNameMap(adminClient, [...profileIds]);

  for (const leave of (approvedLeave ?? []) as LeaveRow[]) {
    const key = `leave_request:${leave.id}`;
    const mapping = mappingByEntity.get(key);

    if (!mapping || mapping.deleted_at) {
      recordFinding(findings, summary, {
        kind: "missing_team_leave_mapping",
        entityType: "leave_request",
        entityId: leave.id,
        leaveRequestId: leave.id,
        detail: "Approved future leave has no active team calendar mapping.",
      });
      continue;
    }

    if (input?.targetGoogleProvider && mappingNeedsGoogleResync(mapping, "google")) {
      recordFinding(findings, summary, {
        kind: "mock_needs_google_sync",
        entityType: "leave_request",
        entityId: leave.id,
        leaveRequestId: leave.id,
        detail: "Mapping was mock-delivered and needs Google resync.",
      });
    }

    const employeeName = profileNames.get(leave.profile_id) ?? "Team member";
    const fingerprint = buildTeamLeaveCalendarEvent({
      request: {
        id: leave.id,
        leaveKind: leave.leave_kind as "annual" | "additional_paid",
        startDate: leave.start_date,
        endDate: leave.end_date,
        dayPortion: leave.day_portion as "full" | "am" | "pm",
      },
      employeeName,
    }).fingerprint;

    if (mapping.content_fingerprint !== fingerprint) {
      recordFinding(findings, summary, {
        kind: "outdated_team_leave_mapping",
        entityType: "leave_request",
        entityId: leave.id,
        leaveRequestId: leave.id,
        detail: "Mapping fingerprint does not match current leave record.",
      });
    }
  }

  for (const leave of (cancelledLeave ?? []) as LeaveRow[]) {
    const key = `leave_request:${leave.id}`;
    const mapping = mappingByEntity.get(key);

    if (mapping && !mapping.deleted_at) {
      recordFinding(findings, summary, {
        kind: "retained_cancelled_leave_mapping",
        entityType: "leave_request",
        entityId: leave.id,
        leaveRequestId: leave.id,
        detail: "Cancelled leave still has an active calendar mapping.",
      });
    }
  }

  for (const sickness of (sicknessRows ?? []) as SicknessRow[]) {
    const key = `sickness:${sickness.id}`;
    const mapping = mappingByEntity.get(key);

    if (!mapping || mapping.deleted_at) {
      recordFinding(findings, summary, {
        kind: "missing_sickness_mapping",
        entityType: "sickness",
        entityId: sickness.id,
        sicknessId: sickness.id,
        detail: "Sickness record has no active management calendar mapping.",
      });
      continue;
    }

    if (input?.targetGoogleProvider && mappingNeedsGoogleResync(mapping, "google")) {
      recordFinding(findings, summary, {
        kind: "mock_needs_google_sync",
        entityType: "sickness",
        entityId: sickness.id,
        sicknessId: sickness.id,
        detail: "Mock sickness mapping will need Google resync.",
      });
    }

    const employeeName = profileNames.get(sickness.profile_id) ?? "Team member";
    const fingerprint = buildSicknessCalendarEvent({
      sickness: {
        id: sickness.id,
        startDate: sickness.start_date,
        endDate: sickness.end_date,
        dayPortion: sickness.day_portion as "full" | "am" | "pm",
      },
      employeeName,
    }).fingerprint;

    if (mapping.content_fingerprint !== fingerprint) {
      recordFinding(findings, summary, {
        kind: "outdated_sickness_mapping",
        entityType: "sickness",
        entityId: sickness.id,
        sicknessId: sickness.id,
        detail: "Sickness mapping fingerprint is outdated.",
      });
    }
  }

  return { londonToday, findings, summary };
}

export async function enqueueStaffLeaveCalendarReconciliation(
  adminClient: SupabaseClient,
  input: { dryRun?: boolean; includeGoogleRefresh?: boolean }
): Promise<CalendarReconciliationEnqueueResult> {
  const scan = await scanStaffLeaveCalendarReconciliation(adminClient, {
    targetGoogleProvider: input.includeGoogleRefresh,
  });

  if (input.dryRun || scan.findings.length === 0) {
    return {
      dryRun: Boolean(input.dryRun),
      enqueued: 0,
      skipped: scan.findings.length,
      findings: scan.findings,
    };
  }

  let enqueued = 0;
  let skipped = 0;

  for (const finding of scan.findings) {
    if (finding.kind === "mock_needs_google_sync") {
      if (!input.includeGoogleRefresh) {
        skipped += 1;
        continue;
      }

      const ok = await insertReconcileOutboxRow(adminClient, {
        calendarChannel:
          finding.entityType === "sickness" ? "sickness_management" : "team_leave",
        operation: "upsert",
        sourceKind: "reconcile_google_refresh",
        leaveRequestId: finding.leaveRequestId ?? null,
        sicknessId: finding.sicknessId ?? null,
        employeeProfileId: null,
      });

      if (ok) {
        enqueued += 1;
      } else {
        skipped += 1;
      }

      continue;
    }

    if (
      finding.kind === "missing_team_leave_mapping" ||
      finding.kind === "outdated_team_leave_mapping"
    ) {
      const ok = await insertReconcileOutboxRow(adminClient, {
        calendarChannel: "team_leave",
        operation: "upsert",
        sourceKind: "reconcile_team_leave_upsert",
        leaveRequestId: finding.leaveRequestId!,
        sicknessId: null,
        employeeProfileId: null,
      });
      if (ok) enqueued += 1;
      else skipped += 1;
      continue;
    }

    if (finding.kind === "retained_cancelled_leave_mapping") {
      const ok = await insertReconcileOutboxRow(adminClient, {
        calendarChannel: "team_leave",
        operation: "delete",
        sourceKind: "reconcile_team_leave_delete",
        leaveRequestId: finding.leaveRequestId!,
        sicknessId: null,
        employeeProfileId: null,
      });
      if (ok) enqueued += 1;
      else skipped += 1;
      continue;
    }

    if (
      finding.kind === "missing_sickness_mapping" ||
      finding.kind === "outdated_sickness_mapping"
    ) {
      const ok = await insertReconcileOutboxRow(adminClient, {
        calendarChannel: "sickness_management",
        operation: "upsert",
        sourceKind: "reconcile_sickness_upsert",
        leaveRequestId: null,
        sicknessId: finding.sicknessId!,
        employeeProfileId: null,
      });
      if (ok) enqueued += 1;
      else skipped += 1;
    }
  }

  return { dryRun: false, enqueued, skipped, findings: scan.findings };
}

async function insertReconcileOutboxRow(
  adminClient: SupabaseClient,
  input: {
    calendarChannel: string;
    operation: string;
    sourceKind: string;
    leaveRequestId: string | null;
    sicknessId: string | null;
    employeeProfileId: string | null;
  }
) {
  let employeeProfileId = input.employeeProfileId;

  if (!employeeProfileId) {
    if (input.leaveRequestId) {
      const { data } = await adminClient
        .from("staff_leave_requests")
        .select("profile_id")
        .eq("id", input.leaveRequestId)
        .maybeSingle();
      employeeProfileId = data?.profile_id ?? null;
    } else if (input.sicknessId) {
      const { data } = await adminClient
        .from("staff_absence_sickness")
        .select("profile_id")
        .eq("id", input.sicknessId)
        .maybeSingle();
      employeeProfileId = data?.profile_id ?? null;
    }
  }

  const { error } = await adminClient.from("staff_leave_calendar_sync_outbox").insert({
    calendar_channel: input.calendarChannel,
    operation: input.operation,
    source_kind: input.sourceKind,
    leave_request_id: input.leaveRequestId,
    sickness_id: input.sicknessId,
    employee_profile_id: employeeProfileId,
    status: "pending",
  });

  if (error) {
    if (error.code === "23505") {
      return false;
    }

    throw error;
  }

  return true;
}

async function loadProfileNameMap(adminClient: SupabaseClient, profileIds: string[]) {
  const profileNames = new Map<string, string>();

  if (profileIds.length === 0) {
    return profileNames;
  }

  const { data, error } = await adminClient
    .from("profiles")
    .select("id, full_name")
    .in("id", profileIds);

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    const name = row.full_name?.trim();
    profileNames.set(row.id, name && name.length > 0 ? name : "Team member");
  }

  return profileNames;
}
