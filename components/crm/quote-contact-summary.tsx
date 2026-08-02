import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QuoteContactDisplay } from "@/lib/crm/quote-contact-display";

type QuoteContactSummaryProps = {
  contact: QuoteContactDisplay | null;
};

export function QuoteContactSummary({ contact }: QuoteContactSummaryProps) {
  if (!contact) {
    return (
      <Card className="portal-surface border-amber-400/50 bg-amber-50">
        <CardContent className="pt-6">
          <p className="text-sm font-medium text-amber-800">No contact linked</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="portal-surface">
      <CardHeader>
        <CardTitle>Contact</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="font-medium">{contact.full_name}</p>
        {contact.job_title ? (
          <p className="text-muted-foreground">{contact.job_title}</p>
        ) : null}
        {contact.email ? (
          <p className="text-muted-foreground">{contact.email}</p>
        ) : null}
        <p className="text-muted-foreground">{contact.company_name}</p>
        <p className="pt-2 text-xs text-muted-foreground">
          {contact.portal_access === "portal"
            ? "Portal access available"
            : "Email only — no portal access"}
        </p>
      </CardContent>
    </Card>
  );
}
