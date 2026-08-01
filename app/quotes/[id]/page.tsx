import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  EditQuoteRequestForm,
  type QuoteRequestEditableValues,
} from "@/components/edit-quote-request-form";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type QuoteRequestDetail = {
  id: string;
  company_id: string;
  requested_by: string;
  project_name: string;
  description: string;
  fulfilment_method: string;
  requested_date: string;
  requested_time: string | null;
  delivery_address_line_1: string | null;
  delivery_address_line_2: string | null;
  delivery_city: string | null;
  delivery_county: string | null;
  delivery_postcode: string | null;
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  purchase_order_number: string | null;
  notes: string | null;
  deadline_status: string;
  request_status: string;
  created_at: string;
};

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const badgeStatuses: BadgeStatus[] = [
  "pending",
  "approved",
  "disabled",
  "draft",
  "sent",
  "accepted",
  "declined",
];

const statusVariantMap: Record<string, BadgeStatus> = {
  pending: "pending",
  approved: "approved",
  disabled: "disabled",
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  submitted: "sent",
  reviewing: "pending",
  overdue: "declined",
  upcoming: "approved",
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatFulfilmentMethod(fulfilmentMethod: string) {
  return fulfilmentMethod === "collection" ? "Collection" : "Delivery";
}

function formatStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapToBadgeStatus(value: string): BadgeStatus {
  const mapped = statusVariantMap[value.toLowerCase()];

  if (mapped) {
    return mapped;
  }

  if (badgeStatuses.includes(value as BadgeStatus)) {
    return value as BadgeStatus;
  }

  return "draft";
}

function formatDeliveryAddress(quoteRequest: QuoteRequestDetail) {
  return [
    quoteRequest.delivery_address_line_1,
    quoteRequest.delivery_address_line_2,
    quoteRequest.delivery_city,
    quoteRequest.delivery_county,
    quoteRequest.delivery_postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatDeliveryContact(quoteRequest: QuoteRequestDetail) {
  if (
    !quoteRequest.delivery_contact_name &&
    !quoteRequest.delivery_contact_phone
  ) {
    return "—";
  }

  return [quoteRequest.delivery_contact_name, quoteRequest.delivery_contact_phone]
    .filter(Boolean)
    .join(" · ");
}

function toEditableValues(
  quoteRequest: QuoteRequestDetail
): QuoteRequestEditableValues {
  return {
    project_name: quoteRequest.project_name,
    description: quoteRequest.description,
    fulfilment_method:
      quoteRequest.fulfilment_method === "collection"
        ? "collection"
        : "delivery",
    requested_date: quoteRequest.requested_date,
    requested_time: quoteRequest.requested_time,
    delivery_address_line_1: quoteRequest.delivery_address_line_1,
    delivery_address_line_2: quoteRequest.delivery_address_line_2,
    delivery_city: quoteRequest.delivery_city,
    delivery_county: quoteRequest.delivery_county,
    delivery_postcode: quoteRequest.delivery_postcode,
    delivery_contact_name: quoteRequest.delivery_contact_name,
    delivery_contact_phone: quoteRequest.delivery_contact_phone,
    purchase_order_number: quoteRequest.purchase_order_number,
    notes: quoteRequest.notes,
  };
}

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const companyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  const { data: quoteRequest, error } = await supabase
    .from("quote_requests")
    .select(
      "id, company_id, requested_by, project_name, description, fulfilment_method, requested_date, requested_time, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, delivery_contact_name, delivery_contact_phone, purchase_order_number, notes, deadline_status, request_status, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !quoteRequest) {
    notFound();
  }

  const canEdit =
    quoteRequest.request_status === "submitted" ||
    quoteRequest.request_status === "reviewing";

  const isDelivery = quoteRequest.fulfilment_method === "delivery";

  return (
    <AppShell userRole="customer" userName={fullName} companyName={companyName}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={quoteRequest.project_name}
          description="Quote request details"
          actions={
            <Link href="/quotes">
              <Button variant="outline">Back to quotes</Button>
            </Link>
          }
        />

        <EditQuoteRequestForm
          quoteRequestId={quoteRequest.id}
          canEdit={canEdit}
          initialValues={toEditableValues(quoteRequest)}
        >
          <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
            <CardHeader className="border-b border-neutral-200">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={mapToBadgeStatus(quoteRequest.deadline_status)}
                  label={formatStatusLabel(quoteRequest.deadline_status)}
                />
                <StatusBadge
                  status={mapToBadgeStatus(quoteRequest.request_status)}
                  label={formatStatusLabel(quoteRequest.request_status)}
                />
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              <dl className="space-y-5 text-sm">
                <div>
                  <dt className="text-neutral-500">Project name</dt>
                  <dd className="mt-1 font-medium text-neutral-950">
                    {quoteRequest.project_name}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Description</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.description}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Fulfilment</dt>
                  <dd className="mt-1 font-medium text-neutral-950">
                    {formatFulfilmentMethod(quoteRequest.fulfilment_method)}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Requested date</dt>
                  <dd className="mt-1 text-neutral-950">
                    {formatDate(quoteRequest.requested_date)}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Requested time</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.requested_time || "—"}
                  </dd>
                </div>

                {isDelivery && (
                  <>
                    <div>
                      <dt className="text-neutral-500">Delivery address</dt>
                      <dd className="mt-1 text-neutral-950">
                        {formatDeliveryAddress(quoteRequest)}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-neutral-500">Delivery contact</dt>
                      <dd className="mt-1 text-neutral-950">
                        {formatDeliveryContact(quoteRequest)}
                      </dd>
                    </div>
                  </>
                )}

                <div>
                  <dt className="text-neutral-500">Purchase order number</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.purchase_order_number || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Notes</dt>
                  <dd className="mt-1 text-neutral-950">
                    {quoteRequest.notes || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="text-neutral-500">Submitted date</dt>
                  <dd className="mt-1 text-neutral-950">
                    {formatDate(quoteRequest.created_at)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </EditQuoteRequestForm>
      </div>
    </AppShell>
  );
}
