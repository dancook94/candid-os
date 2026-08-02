"use client";

import { useState } from "react";

import {
  QuoteBuilderForm,
  type QuoteBuilderInitialValues,
} from "@/components/quote-builder-form";
import { QuoteLinkSetup } from "@/components/crm/quote-link-setup";

type CompanyOption = {
  id: string;
  company_name: string;
  payment_terms_days: number | null;
};

type QuoteRequestOption = {
  id: string;
  company_id: string;
  project_name: string;
};

type OpportunityOption = {
  id: string;
  title: string;
  company_id: string;
  contact_id: string | null;
};

type NewQuoteBuilderShellProps = {
  createdBy: string;
  companies: CompanyOption[];
  quoteRequests: QuoteRequestOption[];
  opportunities: OpportunityOption[];
  initialValues: QuoteBuilderInitialValues;
  fallbackQuotePaymentTermsDays: number;
  prefilledOpportunityId?: string | null;
};

export function NewQuoteBuilderShell({
  createdBy,
  companies,
  quoteRequests,
  opportunities,
  initialValues,
  fallbackQuotePaymentTermsDays,
  prefilledOpportunityId,
}: NewQuoteBuilderShellProps) {
  const [linkMode, setLinkMode] = useState<
    "existing" | "new" | "none" | "prefilled" | null
  >(prefilledOpportunityId ? "prefilled" : null);
  const [linkedOpportunityId, setLinkedOpportunityId] = useState(
    prefilledOpportunityId ?? ""
  );
  const [createOpportunityOnSave, setCreateOpportunityOnSave] = useState(false);

  const linkedOpportunity =
    linkedOpportunityId
      ? opportunities.find((entry) => entry.id === linkedOpportunityId) ?? null
      : null;

  const builderInitialValues: QuoteBuilderInitialValues = {
    ...initialValues,
    opportunityId:
      linkMode === "none"
        ? null
        : linkedOpportunityId || initialValues.opportunityId,
    companyId:
      linkedOpportunity?.company_id ??
      initialValues.companyId,
    contactId:
      linkedOpportunity?.contact_id ??
      initialValues.contactId,
  };

  if (!linkMode) {
    return (
      <QuoteLinkSetup
        opportunities={opportunities}
        onContinue={({ mode, opportunityId }) => {
          setLinkMode(mode);
          setLinkedOpportunityId(opportunityId ?? "");
          setCreateOpportunityOnSave(mode === "new");
        }}
      />
    );
  }

  return (
    <QuoteBuilderForm
      mode="create"
      createdBy={createdBy}
      companies={companies}
      quoteRequests={quoteRequests}
      initialValues={builderInitialValues}
      fallbackQuotePaymentTermsDays={fallbackQuotePaymentTermsDays}
      createOpportunityOnSave={createOpportunityOnSave}
      lockCompany={Boolean(linkedOpportunity)}
      lockContact={Boolean(linkedOpportunity?.contact_id)}
    />
  );
}
