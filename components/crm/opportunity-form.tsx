"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import type { CrmStaffProfile } from "@/lib/crm/crm-staff";
import { getOpportunityStageOptions } from "@/lib/crm/opportunity-stages";
import { getOpportunitySourceOptions } from "@/lib/crm/source-labels";
import {
  parseDateInputValue,
  parseDateTimeLocalValue,
  toDateInputValue,
  toDateTimeLocalValue,
} from "@/lib/crm/format-datetime";
import type { OpportunityStage, OpportunitySource } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/client";

type CompanyOption = {
  id: string;
  company_name: string;
};

type OpportunityFormValues = {
  companyId: string;
  title: string;
  description: string;
  estimatedValue: string;
  stage: OpportunityStage;
  ownerId: string;
  collaboratorIds: string[];
  source: OpportunitySource;
  expectedCloseDate: string;
  nextFollowUpAt: string;
  lostReason: string;
};

type OpportunityFormProps = {
  mode: "create" | "edit";
  companies: CompanyOption[];
  crmStaff: CrmStaffProfile[];
  currentUserId: string;
  opportunityId?: string;
  initialValues?: Partial<OpportunityFormValues>;
  cancelHref: string;
};

function parseEstimatedValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function buildStageTimestamps(
  stage: OpportunityStage,
  previousStage?: OpportunityStage
) {
  if (previousStage !== undefined && previousStage === stage) {
    if (stage === "won") {
      return {};
    }

    if (stage === "lost") {
      return {};
    }

    return {
      won_at: null,
      lost_at: null,
      lost_reason: null,
    };
  }

  const now = new Date().toISOString();

  if (stage === "won") {
    return {
      won_at: now,
      lost_at: null,
      lost_reason: null,
    };
  }

  if (stage === "lost") {
    return {
      won_at: null,
      lost_at: now,
    };
  }

  return {
    won_at: null,
    lost_at: null,
    lost_reason: null,
  };
}

export function OpportunityForm({
  mode,
  companies,
  crmStaff,
  currentUserId,
  opportunityId,
  initialValues,
  cancelHref,
}: OpportunityFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [companyId, setCompanyId] = useState(
    initialValues?.companyId ?? companies[0]?.id ?? ""
  );
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? ""
  );
  const [estimatedValue, setEstimatedValue] = useState(
    initialValues?.estimatedValue ?? ""
  );
  const [stage, setStage] = useState<OpportunityStage>(
    initialValues?.stage ?? "new_enquiry"
  );
  const [ownerId, setOwnerId] = useState(
    initialValues?.ownerId ?? currentUserId
  );
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(
    initialValues?.collaboratorIds ?? []
  );
  const [source, setSource] = useState<OpportunitySource>(
    initialValues?.source ?? "admin"
  );
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    initialValues?.expectedCloseDate ?? ""
  );
  const [nextFollowUpAt, setNextFollowUpAt] = useState(
    initialValues?.nextFollowUpAt ?? ""
  );
  const [lostReason, setLostReason] = useState(initialValues?.lostReason ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const availableCollaborators = useMemo(
    () => crmStaff.filter((member) => member.id !== ownerId),
    [crmStaff, ownerId]
  );

  function toggleCollaborator(profileId: string) {
    setCollaboratorIds((current) =>
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId]
    );
  }

  async function syncCollaborators(
    targetOpportunityId: string,
    previousCollaboratorIds: string[]
  ) {
    const toAdd = collaboratorIds.filter(
      (id) => !previousCollaboratorIds.includes(id)
    );
    const toRemove = previousCollaboratorIds.filter(
      (id) => !collaboratorIds.includes(id)
    );

    if (toRemove.length > 0) {
      const { error: deleteError } = await supabase
        .from("opportunity_members")
        .delete()
        .eq("opportunity_id", targetOpportunityId)
        .in("profile_id", toRemove);

      if (deleteError) {
        throw new Error(deleteError.message);
      }
    }

    if (toAdd.length > 0) {
      const { error: insertError } = await supabase
        .from("opportunity_members")
        .insert(
          toAdd.map((profileId) => ({
            opportunity_id: targetOpportunityId,
            profile_id: profileId,
          }))
        );

      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  async function logActivity(
    targetOpportunityId: string,
    activityType: string,
    description: string,
    metadata: Record<string, unknown> = {}
  ) {
    const { error: activityError } = await supabase
      .from("opportunity_activity")
      .insert({
        opportunity_id: targetOpportunityId,
        activity_type: activityType,
        description,
        metadata,
        created_by: currentUserId,
      });

    if (activityError) {
      throw new Error(activityError.message);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError("Opportunity title is required.");
      return;
    }

    if (!companyId) {
      setError("Company is required.");
      return;
    }

    if (!ownerId) {
      setError("Owner is required.");
      return;
    }

    if (stage === "lost" && !lostReason.trim()) {
      setError("Lost reason is required when stage is Lost.");
      return;
    }

    const parsedEstimatedValue = parseEstimatedValue(estimatedValue);

    if (estimatedValue.trim() && parsedEstimatedValue === null) {
      setError("Estimated value must be a valid non-negative number.");
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const timestamps = buildStageTimestamps(stage);
        const { data: created, error: insertError } = await supabase
          .from("opportunities")
          .insert({
            company_id: companyId,
            title: trimmedTitle,
            description: description.trim() || null,
            estimated_value: parsedEstimatedValue,
            currency: "GBP",
            stage,
            owner_profile_id: ownerId,
            expected_close_date: parseDateInputValue(expectedCloseDate),
            next_follow_up_at: parseDateTimeLocalValue(nextFollowUpAt),
            source,
            lost_reason: stage === "lost" ? lostReason.trim() : null,
            created_by: currentUserId,
            ...timestamps,
          })
          .select("id")
          .single();

        if (insertError || !created) {
          throw new Error(insertError?.message ?? "Unable to create opportunity.");
        }

        if (collaboratorIds.length > 0) {
          const { error: membersError } = await supabase
            .from("opportunity_members")
            .insert(
              collaboratorIds.map((profileId) => ({
                opportunity_id: created.id,
                profile_id: profileId,
              }))
            );

          if (membersError) {
            throw new Error(membersError.message);
          }
        }

        await logActivity(
          created.id,
          OPPORTUNITY_ACTIVITY_TYPES.opportunityCreated,
          `Opportunity "${trimmedTitle}" created.`
        );

        router.push(`/admin/opportunities/${created.id}`);
        router.refresh();
        return;
      }

      if (!opportunityId) {
        throw new Error("Opportunity ID is required for editing.");
      }

      const previousStage = initialValues?.stage ?? "new_enquiry";
      const previousOwnerId = initialValues?.ownerId ?? ownerId;
      const previousEstimatedValue = initialValues?.estimatedValue ?? "";
      const previousCollaboratorIds = initialValues?.collaboratorIds ?? [];
      const timestamps = buildStageTimestamps(stage, previousStage);

      const { error: updateError } = await supabase
        .from("opportunities")
        .update({
          title: trimmedTitle,
          description: description.trim() || null,
          estimated_value: parsedEstimatedValue,
          stage,
          owner_profile_id: ownerId,
          expected_close_date: parseDateInputValue(expectedCloseDate),
          next_follow_up_at: parseDateTimeLocalValue(nextFollowUpAt),
          source,
          lost_reason: stage === "lost" ? lostReason.trim() : null,
          ...timestamps,
        })
        .eq("id", opportunityId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await syncCollaborators(opportunityId, previousCollaboratorIds);

      if (previousStage !== stage) {
        await logActivity(
          opportunityId,
          OPPORTUNITY_ACTIVITY_TYPES.stageChanged,
          `Stage changed from ${previousStage.replaceAll("_", " ")} to ${stage.replaceAll("_", " ")}.`,
          { from: previousStage, to: stage }
        );
      }

      if (previousOwnerId !== ownerId) {
        await logActivity(
          opportunityId,
          OPPORTUNITY_ACTIVITY_TYPES.ownerChanged,
          "Opportunity owner changed.",
          { from: previousOwnerId, to: ownerId }
        );
      }

      const previousCollaboratorKey = [...previousCollaboratorIds].sort().join(",");
      const nextCollaboratorKey = [...collaboratorIds].sort().join(",");

      if (previousCollaboratorKey !== nextCollaboratorKey) {
        await logActivity(
          opportunityId,
          OPPORTUNITY_ACTIVITY_TYPES.collaboratorsChanged,
          "Collaborators updated.",
          {
            from: previousCollaboratorIds,
            to: collaboratorIds,
          }
        );
      }

      if (previousEstimatedValue !== estimatedValue.trim()) {
        await logActivity(
          opportunityId,
          OPPORTUNITY_ACTIVITY_TYPES.estimatedValueChanged,
          "Estimated value updated.",
          {
            from: previousEstimatedValue || null,
            to: estimatedValue.trim() || null,
          }
        );
      }

      router.push(`/admin/opportunities/${opportunityId}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save opportunity."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="portal-surface">
      <CardHeader>
        <CardTitle>
          {mode === "create" ? "New opportunity" : "Edit opportunity"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="company">Company</Label>
              <Select
                id="company"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                disabled={mode === "edit"}
                required
              >
                <option value="">Select company…</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="title">Opportunity title</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimatedValue">Estimated value (GBP)</Label>
              <Input
                id="estimatedValue"
                type="number"
                min="0"
                step="0.01"
                value={estimatedValue}
                onChange={(event) => setEstimatedValue(event.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stage">Stage</Label>
              <Select
                id="stage"
                value={stage}
                onChange={(event) =>
                  setStage(event.target.value as OpportunityStage)
                }
              >
                {getOpportunityStageOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            {stage === "lost" ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="lostReason">Lost reason</Label>
                <Textarea
                  id="lostReason"
                  value={lostReason}
                  onChange={(event) => setLostReason(event.target.value)}
                  rows={3}
                  required
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="owner">Owner</Label>
              <Select
                id="owner"
                value={ownerId}
                onChange={(event) => {
                  const nextOwnerId = event.target.value;
                  setOwnerId(nextOwnerId);
                  setCollaboratorIds((current) =>
                    current.filter((id) => id !== nextOwnerId)
                  );
                }}
                required
              >
                {crmStaff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name?.trim() || "Unnamed staff member"}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Select
                id="source"
                value={source}
                onChange={(event) =>
                  setSource(event.target.value as OpportunitySource)
                }
              >
                {getOpportunitySourceOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expectedCloseDate">Expected close date</Label>
              <Input
                id="expectedCloseDate"
                type="date"
                value={expectedCloseDate}
                onChange={(event) => setExpectedCloseDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nextFollowUpAt">Next follow-up</Label>
              <Input
                id="nextFollowUpAt"
                type="datetime-local"
                value={nextFollowUpAt}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Collaborators</Label>
            <div className="grid gap-2 rounded-xl border border-border p-4 md:grid-cols-2">
              {availableCollaborators.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No other CRM staff available.
                </p>
              ) : (
                availableCollaborators.map((member) => (
                  <label
                    key={member.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={collaboratorIds.includes(member.id)}
                      onChange={() => toggleCollaborator(member.id)}
                      className="rounded border-input"
                    />
                    <span>{member.full_name?.trim() || "Unnamed staff member"}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : mode === "create"
                  ? "Create opportunity"
                  : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(cancelHref)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function buildOpportunityFormInitialValues(
  opportunity: {
    company_id: string;
    title: string;
    description: string | null;
    estimated_value: number | string | null;
    stage: OpportunityStage;
    owner_profile_id: string;
    source: OpportunitySource;
    expected_close_date: string | null;
    next_follow_up_at: string | null;
    lost_reason: string | null;
  },
  collaboratorIds: string[]
): Partial<OpportunityFormValues> {
  const estimated =
    opportunity.estimated_value === null ||
    opportunity.estimated_value === undefined
      ? ""
      : String(opportunity.estimated_value);

  return {
    companyId: opportunity.company_id,
    title: opportunity.title,
    description: opportunity.description ?? "",
    estimatedValue: estimated,
    stage: opportunity.stage,
    ownerId: opportunity.owner_profile_id,
    collaboratorIds,
    source: opportunity.source,
    expectedCloseDate: toDateInputValue(opportunity.expected_close_date),
    nextFollowUpAt: toDateTimeLocalValue(opportunity.next_follow_up_at),
    lostReason: opportunity.lost_reason ?? "",
  };
}
