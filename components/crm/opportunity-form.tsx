"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyContactSelect } from "@/components/crm/company-contact-select";
import {
  StaffMultiSelect,
  StaffOwnerSelect,
} from "@/components/crm/staff-multi-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import type { CrmStaffProfile } from "@/lib/crm/crm-staff";
import { getOpportunityStageOptions } from "@/lib/crm/opportunity-stages";
import { getOpportunitySourceOptions } from "@/lib/crm/source-labels";
import type { OpportunityFormValues } from "@/lib/crm/opportunity-form-values";
import type { OpportunityStage, OpportunitySource } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/client";

type CompanyOption = {
  id: string;
  company_name: string;
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
  const [contactId, setContactId] = useState(initialValues?.contactId ?? "");
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

  async function logActivity(
    targetOpportunityId: string,
    activityType: string,
    description: string,
    metadata: Record<string, unknown> = {}
  ) {
    const { error: activityError } = await supabase.from("crm_activity").insert({
      opportunity_id: targetOpportunityId,
      activity_type: activityType,
      description,
      metadata,
      actor_profile_id: currentUserId,
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

    if (!contactId) {
      setError("Contact is required.");
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
        const createResponse = await fetch("/api/crm/opportunities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            contactId,
            title: trimmedTitle,
            description: description.trim() || null,
            estimatedValue: estimatedValue.trim() || null,
            stage,
            ownerProfileId: ownerId,
            collaboratorProfileIds: collaboratorIds,
            source,
            expectedCloseDate: expectedCloseDate || null,
            nextFollowUpAt: nextFollowUpAt || null,
            lostReason: stage === "lost" ? lostReason.trim() : null,
          }),
        });

        const createPayload = (await createResponse.json()) as {
          opportunityId?: string;
          error?: string;
        };

        if (!createResponse.ok || !createPayload.opportunityId) {
          throw new Error(
            createPayload.error ?? "Unable to create opportunity."
          );
        }

        router.push(`/admin/opportunities/${createPayload.opportunityId}`);
        router.refresh();
        return;
      }

      if (!opportunityId) {
        throw new Error("Opportunity ID is required for editing.");
      }

      const previousStage = initialValues?.stage ?? "new_enquiry";
      const previousEstimatedValue = initialValues?.estimatedValue ?? "";
      const timestamps = buildStageTimestamps(stage, previousStage);

      const updateResponse = await fetch(
        `/api/crm/opportunities/${opportunityId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId,
            title: trimmedTitle,
            description: description.trim() || null,
            estimatedValue: estimatedValue.trim() || null,
            stage,
            source,
            expectedCloseDate: expectedCloseDate || null,
            nextFollowUpAt: nextFollowUpAt || null,
            lostReason: stage === "lost" ? lostReason.trim() : null,
            timestamps,
          }),
        }
      );

      const updatePayload = (await updateResponse.json()) as { error?: string };

      if (!updateResponse.ok) {
        throw new Error(updatePayload.error ?? "Unable to update opportunity.");
      }

      const assignmentResponse = await fetch(
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

      const assignmentPayload = (await assignmentResponse.json()) as {
        error?: string;
      };

      if (!assignmentResponse.ok) {
        throw new Error(
          assignmentPayload.error ?? "Unable to update assignments."
        );
      }

      if (previousStage !== stage) {
        await logActivity(
          opportunityId,
          OPPORTUNITY_ACTIVITY_TYPES.stageChanged,
          `Stage changed from ${previousStage.replaceAll("_", " ")} to ${stage.replaceAll("_", " ")}.`,
          { from: previousStage, to: stage }
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
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  setContactId("");
                }}
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
              <CompanyContactSelect
                companyId={companyId}
                value={contactId}
                onChange={setContactId}
                companies={companies}
                required
              />
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
