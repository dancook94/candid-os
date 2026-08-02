"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  StaffMultiSelect,
  StaffOwnerSelect,
} from "@/components/crm/staff-multi-select";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CrmStaffProfile } from "@/lib/crm/crm-staff";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { StaffAvatarStack } from "@/components/crm/staff-avatar-stack";

type OpportunityAssignmentEditorProps = {
  opportunityId: string;
  crmStaff: CrmStaffProfile[];
  ownerId: string;
  collaboratorIds: string[];
  editable?: boolean;
};

export function OpportunityAssignmentEditor({
  opportunityId,
  crmStaff,
  ownerId: initialOwnerId,
  collaboratorIds: initialCollaboratorIds,
  editable = true,
}: OpportunityAssignmentEditorProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [ownerId, setOwnerId] = useState(initialOwnerId);
  const [collaboratorIds, setCollaboratorIds] = useState(
    initialCollaboratorIds
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const owner = crmStaff.find((member) => member.id === initialOwnerId);
  const collaborators = crmStaff.filter((member) =>
    initialCollaboratorIds.includes(member.id)
  );

  async function handleSave() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/crm/opportunities/${opportunityId}/assignments`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerProfileId: ownerId,
            collaboratorProfileIds: collaboratorIds,
          }),
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update assignments.");
      }

      setIsEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update assignments."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!editable) {
    return (
      <Card className="portal-surface">
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Owner
            </p>
            <div className="mt-1 flex items-center gap-2">
              <StaffAvatarDisplay
                fullName={getStaffDisplayName(owner ?? { full_name: null })}
                size="sm"
              />
              <span>{getStaffDisplayName(owner ?? { full_name: null })}</span>
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Collaborators
            </p>
            <div className="mt-1">
              <StaffAvatarStack members={collaborators} size="sm" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="portal-surface">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Team</CardTitle>
        {!isEditing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setOwnerId(initialOwnerId);
              setCollaboratorIds(initialCollaboratorIds);
              setIsEditing(true);
            }}
          >
            Edit assignments
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!isEditing ? (
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Owner
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StaffAvatarDisplay
                  fullName={getStaffDisplayName(owner ?? { full_name: null })}
                  size="sm"
                />
                <span>{getStaffDisplayName(owner ?? { full_name: null })}</span>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Collaborators
              </p>
              <div className="mt-1">
                {collaborators.length > 0 ? (
                  <StaffAvatarStack members={collaborators} size="sm" />
                ) : (
                  <p className="text-sm text-muted-foreground">None</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <StaffOwnerSelect
              staff={crmStaff}
              value={ownerId}
              onChange={(nextOwnerId) => {
                setOwnerId(nextOwnerId);
                setCollaboratorIds((current) =>
                  current.filter((id) => id !== nextOwnerId)
                );
              }}
            />
            <StaffMultiSelect
              label="Collaborators"
              staff={crmStaff}
              selectedIds={collaboratorIds}
              onChange={setCollaboratorIds}
              excludeIds={[ownerId]}
              minSelected={0}
            />
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Saving…" : "Save assignments"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOwnerId(initialOwnerId);
                  setCollaboratorIds(initialCollaboratorIds);
                  setIsEditing(false);
                  setError("");
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
