import type { SupabaseClient } from "@supabase/supabase-js";

import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { STAFF_ROLES } from "@/lib/staff-roles";

export type LeaveRequestRow = {
  id: string;
  profile_id: string;
  holiday_year: number;
  status: string;
  start_date: string;
  end_date: string;
  day_portion: string;
  days_requested: number;
  employee_note: string | null;
  decision_note: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  leave_kind: string;
  grant_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type LeaveRequestWithProfile = LeaveRequestRow & {
  profiles:
    | { full_name: string | null; user_role: string }
    | { full_name: string | null; user_role: string }[]
    | null;
};

export type BankHolidayRow = {
  holiday_date: string;
  name: string;
  holiday_year: number;
};

export type CompanyClosureRow = {
  closure_date: string;
  name: string;
  closure_kind: string;
  holiday_year: number;
};

export type StaffMemberOption = {
  id: string;
  full_name: string | null;
  user_role: string;
};

export function leaveRequestProfileName(
  profiles: LeaveRequestWithProfile["profiles"]
) {
  if (!profiles) {
    return null;
  }

  if (Array.isArray(profiles)) {
    return profiles[0]?.full_name ?? null;
  }

  return profiles.full_name;
}

export async function fetchPendingLeaveCount(supabase: SupabaseClient) {
  const { count, error } = await supabase
    .from("staff_leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .gte("holiday_year", STAFF_LEAVE_FIRST_POLICY_YEAR);

  return { count: error ? 0 : count ?? 0, error: error?.message ?? null };
}

export async function fetchLeaveBalance(
  supabase: SupabaseClient,
  profileId: string,
  holidayYear: number
) {
  const { data, error } = await supabase.rpc("staff_leave_balance", {
    target_profile: profileId,
    p_holiday_year: holidayYear,
  });

  const row = Array.isArray(data) ? data[0] : data;
  return { balance: row, error: error?.message ?? null };
}

export async function fetchOwnLeaveRequests(
  supabase: SupabaseClient,
  profileId: string,
  holidayYear: number
) {
  const { data, error } = await supabase
    .from("staff_leave_requests")
    .select(
      "id, profile_id, holiday_year, leave_kind, status, start_date, end_date, day_portion, days_requested, employee_note, decision_note, grant_reason, cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at"
    )
    .eq("profile_id", profileId)
    .eq("holiday_year", holidayYear)
    .order("start_date", { ascending: false });

  return { requests: (data ?? []) as LeaveRequestRow[], error: error?.message ?? null };
}

export async function fetchLeaveRequestsForAdmin(
  supabase: SupabaseClient,
  input: { holidayYear: number; status?: string | null }
) {
  let query = supabase
    .from("staff_leave_requests")
    .select(
      "id, profile_id, holiday_year, leave_kind, status, start_date, end_date, day_portion, days_requested, employee_note, decision_note, grant_reason, cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at, profiles(full_name, user_role)"
    )
    .eq("holiday_year", input.holidayYear)
    .order("created_at", { ascending: false });

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;
  return { requests: (data ?? []) as LeaveRequestWithProfile[], error: error?.message ?? null };
}

export async function fetchApprovedTeamLeave(
  supabase: SupabaseClient,
  holidayYear: number
) {
  const { data, error } = await supabase
    .from("staff_leave_requests")
    .select(
      "id, profile_id, start_date, end_date, day_portion, days_requested, status, leave_kind, profiles(full_name)"
    )
    .eq("holiday_year", holidayYear)
    .in("status", ["approved", "pending"])
    .order("start_date", { ascending: true });

  return { requests: data ?? [], error: error?.message ?? null };
}

export async function fetchLeaveReferenceData(
  supabase: SupabaseClient,
  holidayYear: number
) {
  const [bankHolidays, closures] = await Promise.all([
    supabase
      .from("staff_bank_holidays")
      .select("holiday_date, name, holiday_year")
      .eq("holiday_year", holidayYear)
      .order("holiday_date"),
    supabase
      .from("staff_leave_company_closures")
      .select("closure_date, name, closure_kind, holiday_year")
      .eq("holiday_year", holidayYear)
      .order("closure_date"),
  ]);

  return {
    bankHolidays: (bankHolidays.data ?? []) as BankHolidayRow[],
    closures: (closures.data ?? []) as CompanyClosureRow[],
    error: bankHolidays.error?.message ?? closures.error?.message ?? null,
  };
}

export async function fetchStaffMembersForLeaveAdmin(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, user_role")
    .eq("account_status", "approved")
    .in("user_role", [...STAFF_ROLES])
    .order("full_name");

  return { members: (data ?? []) as StaffMemberOption[], error: error?.message ?? null };
}

export async function fetchSubmittedByLabelsForRequests(
  supabase: SupabaseClient,
  requests: Array<{ id: string; profile_id: string }>
) {
  const ids = requests.map((row) => row.id);
  if (ids.length === 0) {
    return {} as Record<string, string>;
  }

  const { data: events, error } = await supabase
    .from("staff_leave_request_events")
    .select("request_id, actor_profile_id, payload, created_at")
    .in("request_id", ids)
    .eq("event_type", "submitted")
    .order("created_at", { ascending: true });

  if (error || !events?.length) {
    return {} as Record<string, string>;
  }

  const actorIds = [
    ...new Set(events.map((row) => row.actor_profile_id).filter((id): id is string => !!id)),
  ];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", actorIds);

  const nameById = new Map(
    (profiles ?? []).map((row) => [row.id, row.full_name ?? "Manager"] as const)
  );

  const labels: Record<string, string> = {};
  const requestById = new Map(requests.map((row) => [row.id, row.profile_id] as const));

  for (const event of events) {
    const ownerId = requestById.get(event.request_id);
    if (!ownerId || !event.actor_profile_id) {
      continue;
    }

    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : null;
    const onBehalf = payload?.submitted_on_behalf === true;
    const actorDiffers = event.actor_profile_id !== ownerId;

    if (!onBehalf && !actorDiffers) {
      continue;
    }

    if (event.request_id in labels) {
      continue;
    }

    labels[event.request_id] = nameById.get(event.actor_profile_id) ?? "Manager";
  }

  return labels;
}

export async function fetchWhoIsOffToday(supabase: SupabaseClient, todayIso: string) {
  const { data, error } = await supabase
    .from("staff_leave_requests")
    .select(
      "id, profile_id, start_date, end_date, day_portion, status, profiles(full_name)"
    )
    .eq("status", "approved")
    .lte("start_date", todayIso)
    .gte("end_date", todayIso);

  return { rows: data ?? [], error: error?.message ?? null };
}

export async function fetchEntitlementAdjustment(
  supabase: SupabaseClient,
  profileId: string,
  holidayYear: number
) {
  const { data, error } = await supabase
    .from("staff_leave_entitlements")
    .select("id, adjustment_days, prorata_start_date, adjustment_reason")
    .eq("profile_id", profileId)
    .eq("holiday_year", holidayYear)
    .maybeSingle();

  return { entitlement: data, error: error?.message ?? null };
}

export async function fetchStaffLeaveBalances(
  supabase: SupabaseClient,
  memberIds: string[],
  holidayYear: number
) {
  const rows = await Promise.all(
    memberIds.map(async (profileId) => {
      const { data, error } = await supabase.rpc("staff_leave_balance", {
        target_profile: profileId,
        p_holiday_year: holidayYear,
      });
      const balance = Array.isArray(data) ? data[0] : data;
      return { profileId, balance, error: error?.message ?? null };
    })
  );

  return { rows };
}

export async function fetchWorkingPattern(
  supabase: SupabaseClient,
  profileId: string
) {
  const { data, error } = await supabase
    .from("staff_working_patterns")
    .select(
      "id, effective_from, works_mon, works_tue, works_wed, works_thu, works_fri, works_sat, works_sun, fte_ratio"
    )
    .eq("profile_id", profileId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { pattern: data, error: error?.message ?? null };
}

export async function fetchWorkingPatternHistory(
  supabase: SupabaseClient,
  profileId: string
) {
  const { data, error } = await supabase
    .from("staff_working_patterns")
    .select(
      "id, effective_from, works_mon, works_tue, works_wed, works_thu, works_fri, works_sat, works_sun, fte_ratio, created_at"
    )
    .eq("profile_id", profileId)
    .order("effective_from", { ascending: false });

  return { patterns: data ?? [], error: error?.message ?? null };
}
