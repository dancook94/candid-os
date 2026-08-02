"use client";

import { useMemo, useState } from "react";

import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import type { CrmStaffProfile } from "@/lib/crm/crm-staff";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRoleLabel } from "@/lib/staff-roles";
import { cn } from "@/lib/utils";

type StaffMultiSelectProps = {
  id?: string;
  label?: string;
  staff: CrmStaffProfile[];
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  excludeIds?: string[];
  disabled?: boolean;
  minSelected?: number;
};

export function StaffMultiSelect({
  id = "staffMultiSelect",
  label = "Assigned staff",
  staff,
  selectedIds,
  onChange,
  excludeIds = [],
  disabled = false,
  minSelected = 1,
}: StaffMultiSelectProps) {
  const [search, setSearch] = useState("");

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  const availableStaff = useMemo(
    () => staff.filter((member) => !excluded.has(member.id)),
    [staff, excluded]
  );

  const selectedStaff = useMemo(
    () =>
      selectedIds
        .map((profileId) => staff.find((member) => member.id === profileId))
        .filter((member): member is CrmStaffProfile => Boolean(member)),
    [selectedIds, staff]
  );

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return availableStaff;
    }

    return availableStaff.filter((member) => {
      const name = getStaffDisplayName(member).toLowerCase();
      const role = formatRoleLabel(member.user_role).toLowerCase();
      return name.includes(term) || role.includes(term);
    });
  }, [availableStaff, search]);

  function addMember(profileId: string) {
    if (selectedIds.includes(profileId)) {
      return;
    }

    onChange([...selectedIds, profileId]);
  }

  function removeMember(profileId: string) {
    if (selectedIds.length <= minSelected) {
      return;
    }

    onChange(selectedIds.filter((id) => id !== profileId));
  }

  return (
    <div className="space-y-3">
      <Label htmlFor={`${id}-search`}>{label}</Label>

      {selectedStaff.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedStaff.map((member) => (
            <span
              key={member.id}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2 py-1 text-sm"
            >
              <StaffAvatarDisplay
                fullName={getStaffDisplayName(member)}
                size="sm"
              />
              <span>{getStaffDisplayName(member)}</span>
              {!disabled && selectedIds.length > minSelected ? (
                <button
                  type="button"
                  className="rounded-full px-1 text-muted-foreground hover:text-foreground"
                  onClick={() => removeMember(member.id)}
                  aria-label={`Remove ${getStaffDisplayName(member)}`}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No staff selected.</p>
      )}

      <Input
        id={`${id}-search`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search staff by name or role…"
        disabled={disabled}
      />

      <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
        {filteredStaff.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            No matching staff.
          </p>
        ) : (
          filteredStaff.map((member) => {
            const isSelected = selectedIds.includes(member.id);

            return (
              <button
                key={member.id}
                type="button"
                disabled={disabled || isSelected}
                onClick={() => addMember(member.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                  isSelected
                    ? "cursor-default bg-muted/60 opacity-70"
                    : "hover:bg-muted/50"
                )}
              >
                <StaffAvatarDisplay
                  fullName={getStaffDisplayName(member)}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {getStaffDisplayName(member)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatRoleLabel(member.user_role)}
                  </span>
                </span>
                {isSelected ? (
                  <span className="text-xs text-muted-foreground">Selected</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

type StaffOwnerSelectProps = {
  id?: string;
  label?: string;
  staff: CrmStaffProfile[];
  value: string;
  onChange: (profileId: string) => void;
  disabled?: boolean;
};

export function StaffOwnerSelect({
  id = "owner",
  label = "Primary owner",
  staff,
  value,
  onChange,
  disabled = false,
}: StaffOwnerSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {getStaffDisplayName(member)} · {formatRoleLabel(member.user_role)}
          </option>
        ))}
      </select>
    </div>
  );
}
