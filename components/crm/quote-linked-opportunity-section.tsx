import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";

import {
  LinkQuoteToOpportunityDialog,
  type LinkableOpportunity,
} from "@/components/crm/link-quote-opportunity-dialog";
import { OpportunityStageBadge } from "@/components/crm/opportunity-stage-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { OpportunityStage } from "@/lib/crm/types";
import { formatGbp } from "@/lib/format-currency";

export type { LinkableOpportunity };

type LinkedOpportunityData = {
  id: string;
  title: string;
  stage: OpportunityStage;
  company_name: string;
  owner_name: string;
  estimated_value: number | null;
  next_follow_up_at: string | null;
};

type QuoteLinkedOpportunitySectionProps = {
  quoteId: string;
  quoteNumber: number;
  companyName: string;
  linkableOpportunities: LinkableOpportunity[];
  linkedOpportunity: LinkedOpportunityData | null;
};

export function QuoteLinkedOpportunitySection({
  quoteId,
  quoteNumber,
  companyName,
  linkableOpportunities,
  linkedOpportunity,
}: QuoteLinkedOpportunitySectionProps) {
  if (!linkedOpportunity) {
    return (
      <Card className="portal-surface mb-6">
        <CardHeader>
          <CardTitle>Linked opportunity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This quote is not linked to an opportunity.
          </p>
          <LinkQuoteToOpportunityDialog
            quoteId={quoteId}
            quoteNumber={quoteNumber}
            companyName={companyName}
            opportunities={linkableOpportunities}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="portal-surface mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Linked opportunity</CardTitle>
        <Link href={`/admin/opportunities/${linkedOpportunity.id}`}>
          <Button variant="outline" size="sm">
            View opportunity
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Opportunity
          </p>
          <Link
            href={`/admin/opportunities/${linkedOpportunity.id}`}
            className="mt-1 block font-medium hover:underline"
          >
            {linkedOpportunity.title}
          </Link>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Company
          </p>
          <p className="mt-1 font-medium">{linkedOpportunity.company_name}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Stage
          </p>
          <div className="mt-1">
            <OpportunityStageBadge stage={linkedOpportunity.stage} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Owner
          </p>
          <p className="mt-1 font-medium">{linkedOpportunity.owner_name}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Estimated value
          </p>
          <p className="mt-1 font-medium">
            {linkedOpportunity.estimated_value !== null
              ? formatGbp(linkedOpportunity.estimated_value)
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Next follow-up
          </p>
          <p className="mt-1 font-medium">
            {formatCrmDateTime(linkedOpportunity.next_follow_up_at)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export async function loadLinkedOpportunityForQuote(
  supabase: SupabaseClient,
  opportunityId: string | null
): Promise<LinkedOpportunityData | null> {
  if (!opportunityId) {
    return null;
  }

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(
      "id, title, stage, company_id, owner_profile_id, estimated_value, next_follow_up_at"
    )
    .eq("id", opportunityId)
    .maybeSingle();

  if (!opportunity) {
    return null;
  }

  const [{ data: company }, { data: owner }] = await Promise.all([
    supabase
      .from("companies")
      .select("company_name")
      .eq("id", opportunity.company_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", opportunity.owner_profile_id)
      .maybeSingle(),
  ]);

  return {
    id: opportunity.id,
    title: opportunity.title,
    stage: opportunity.stage as OpportunityStage,
    company_name: company?.company_name ?? "Unknown company",
    owner_name: getStaffDisplayName(owner ?? { full_name: null }),
    estimated_value:
      opportunity.estimated_value === null
        ? null
        : Number(opportunity.estimated_value),
    next_follow_up_at: opportunity.next_follow_up_at,
  };
}

export async function loadLinkableOpportunitiesForCompany(
  supabase: SupabaseClient,
  companyId: string
): Promise<LinkableOpportunity[]> {
  const { data } = await supabase
    .from("opportunities")
    .select("id, title, stage")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(100);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    stage: row.stage as OpportunityStage,
  }));
}
