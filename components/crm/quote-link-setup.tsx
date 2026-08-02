"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type OpportunityOption = {
  id: string;
  title: string;
  company_id: string;
  contact_id: string | null;
};

type QuoteLinkSetupProps = {
  opportunities: OpportunityOption[];
  onContinue: (result: {
    mode: "existing" | "new" | "none";
    opportunityId: string | null;
  }) => void;
};

export function QuoteLinkSetup({
  opportunities,
  onContinue,
}: QuoteLinkSetupProps) {
  const [mode, setMode] = useState<"existing" | "new" | "none">("existing");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(
    opportunities[0]?.id ?? ""
  );
  const [confirmedNone, setConfirmedNone] = useState(false);

  const selectedOpportunity = opportunities.find(
    (entry) => entry.id === selectedOpportunityId
  );

  return (
    <div className="portal-surface mb-6 rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold">Link to opportunity</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose how this quote should connect to the sales pipeline.
      </p>

      <div className="mt-4 space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="linkMode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />
          <span>Link to existing opportunity</span>
        </label>

        {mode === "existing" ? (
          <div className="ml-6 space-y-2">
            <Label htmlFor="existingOpportunity">Opportunity</Label>
            <Select
              id="existingOpportunity"
              value={selectedOpportunityId}
              onChange={(event) => setSelectedOpportunityId(event.target.value)}
            >
              {opportunities.map((opportunity) => (
                <option key={opportunity.id} value={opportunity.id}>
                  {opportunity.title}
                </option>
              ))}
            </Select>
            {selectedOpportunity && !selectedOpportunity.contact_id ? (
              <p className="text-sm text-amber-700">
                Add a contact to this opportunity before creating a quote.
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="linkMode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          <span>Create new opportunity when the draft quote is saved</span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="linkMode"
            checked={mode === "none"}
            onChange={() => setMode("none")}
          />
          <span>Create quote without opportunity</span>
        </label>

        {mode === "none" ? (
          <div className="ml-6 rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={confirmedNone}
                onChange={(event) => setConfirmedNone(event.target.checked)}
              />
              <span>
                I understand this quote will not be linked to the CRM pipeline.
              </span>
            </label>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <Button
          type="button"
          disabled={
            (mode === "none" && !confirmedNone) ||
            (mode === "existing" &&
              (!selectedOpportunityId ||
                !selectedOpportunity?.contact_id))
          }
          onClick={() =>
            onContinue({
              mode,
              opportunityId:
                mode === "existing" ? selectedOpportunityId || null : null,
            })
          }
        >
          Continue to quote builder
        </Button>
      </div>
    </div>
  );
}
