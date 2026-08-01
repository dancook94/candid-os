"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type FulfilmentMethod = "delivery" | "collection";

type QuoteRequestInsert = {
  company_id: string;
  requested_by: string;
  project_name: string;
  description: string;
  fulfilment_method: FulfilmentMethod;
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
  deadline_status: "pending";
  request_status: "submitted";
};

type QuoteRequestFormProps = {
  companyId: string;
  requestedBy: string;
};

type FieldErrors = Record<string, string>;

const fieldClassName =
  "min-h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatReviewDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDeliveryAddress(
  line1: string,
  line2: string,
  city: string,
  county: string,
  postcode: string
) {
  return [line1, line2, city, county, postcode].filter(Boolean).join(", ");
}

export function QuoteRequestForm({
  companyId,
  requestedBy,
}: QuoteRequestFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [fulfilmentMethod, setFulfilmentMethod] =
    useState<FulfilmentMethod>("delivery");
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedTime, setRequestedTime] = useState("");
  const [deliveryAddressLine1, setDeliveryAddressLine1] = useState("");
  const [deliveryAddressLine2, setDeliveryAddressLine2] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryCounty, setDeliveryCounty] = useState("");
  const [deliveryPostcode, setDeliveryPostcode] = useState("");
  const [deliveryContactName, setDeliveryContactName] = useState("");
  const [deliveryContactPhone, setDeliveryContactPhone] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [notes, setNotes] = useState("");

  const minDate = useMemo(() => getTodayString(), []);

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validateStep(currentStep: number) {
    const errors: FieldErrors = {};

    if (currentStep === 1) {
      if (!projectName.trim()) {
        errors.projectName = "Project name is required.";
      }

      if (!description.trim()) {
        errors.description = "Project description is required.";
      }
    }

    if (currentStep === 2) {
      if (!requestedDate) {
        errors.requestedDate = "Required date is required.";
      } else if (requestedDate < minDate) {
        errors.requestedDate = "Required date cannot be in the past.";
      }

      if (fulfilmentMethod === "delivery") {
        if (!deliveryAddressLine1.trim()) {
          errors.deliveryAddressLine1 = "Address line 1 is required.";
        }

        if (!deliveryPostcode.trim()) {
          errors.deliveryPostcode = "Postcode is required.";
        }

        if (!deliveryContactName.trim()) {
          errors.deliveryContactName = "Contact name is required.";
        }

        if (!deliveryContactPhone.trim()) {
          errors.deliveryContactPhone = "Contact phone is required.";
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleNext() {
    setError("");

    if (!validateStep(step)) {
      return;
    }

    setStep((current) => Math.min(current + 1, 3));
  }

  function handleBack() {
    setError("");
    setStep((current) => Math.max(current - 1, 1));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (step !== 3) {
      return;
    }

    if (!validateStep(1) || !validateStep(2)) {
      setStep(!projectName.trim() || !description.trim() ? 1 : 2);
      return;
    }

    setIsSubmitting(true);

    const isDelivery = fulfilmentMethod === "delivery";

    const insertPayload: QuoteRequestInsert = {
      company_id: companyId,
      requested_by: requestedBy,
      project_name: projectName.trim(),
      description: description.trim(),
      fulfilment_method: fulfilmentMethod,
      requested_date: requestedDate,
      requested_time: requestedTime.trim() || null,
      delivery_address_line_1: isDelivery
        ? deliveryAddressLine1.trim()
        : null,
      delivery_address_line_2: isDelivery
        ? deliveryAddressLine2.trim() || null
        : null,
      delivery_city: isDelivery ? deliveryCity.trim() || null : null,
      delivery_county: isDelivery ? deliveryCounty.trim() || null : null,
      delivery_postcode: isDelivery ? deliveryPostcode.trim() : null,
      delivery_contact_name: isDelivery ? deliveryContactName.trim() : null,
      delivery_contact_phone: isDelivery ? deliveryContactPhone.trim() : null,
      purchase_order_number: purchaseOrderNumber.trim() || null,
      notes: notes.trim() || null,
      deadline_status: "pending",
      request_status: "submitted",
    };

    const { error: insertError } = await supabase
      .from("quote_requests")
      .insert(insertPayload);

    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push("/quotes");
    router.refresh();
  }

  return (
    <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardHeader className="border-b border-neutral-200">
        <CardTitle className="text-lg font-semibold text-neutral-950">
          Quote request
        </CardTitle>
        <CardDescription>
          Step {step} of 3 —{" "}
          {step === 1
            ? "Project details"
            : step === 2
              ? "Delivery details"
              : "Additional information"}
        </CardDescription>

        <div className="mt-4 flex gap-2">
          {[1, 2, 3].map((stepNumber) => (
            <div
              key={stepNumber}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                stepNumber <= step ? "bg-neutral-950" : "bg-neutral-200"
              )}
            />
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <form className="space-y-6" onSubmit={handleSubmit}>
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="projectName">Project name</Label>
                <Input
                  id="projectName"
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    clearFieldError("projectName");
                  }}
                  placeholder="Summer campaign launch"
                  aria-invalid={Boolean(fieldErrors.projectName)}
                />
                {fieldErrors.projectName && (
                  <p className="text-sm text-red-600">
                    {fieldErrors.projectName}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Project description</Label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    clearFieldError("description");
                  }}
                  rows={5}
                  placeholder="Describe the project scope, quantities, and specifications."
                  className={fieldClassName}
                  aria-invalid={Boolean(fieldErrors.description)}
                />
                {fieldErrors.description && (
                  <p className="text-sm text-red-600">
                    {fieldErrors.description}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Fulfilment</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["delivery", "collection"] as const).map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={
                        fulfilmentMethod === option ? "default" : "outline"
                      }
                      onClick={() => {
                        setFulfilmentMethod(option);
                        setFieldErrors({});
                      }}
                    >
                      {option === "delivery" ? "Delivery" : "Collection"}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="requestedDate">Required date</Label>
                  <Input
                    id="requestedDate"
                    type="date"
                    min={minDate}
                    value={requestedDate}
                    onChange={(event) => {
                      setRequestedDate(event.target.value);
                      clearFieldError("requestedDate");
                    }}
                    aria-invalid={Boolean(fieldErrors.requestedDate)}
                  />
                  {fieldErrors.requestedDate && (
                    <p className="text-sm text-red-600">
                      {fieldErrors.requestedDate}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="requestedTime">Preferred time</Label>
                  <Input
                    id="requestedTime"
                    value={requestedTime}
                    onChange={(event) => setRequestedTime(event.target.value)}
                    placeholder="e.g. 09:00–12:00"
                  />
                </div>
              </div>

              {fulfilmentMethod === "delivery" && (
                <div className="space-y-5 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="deliveryAddressLine1">Address line 1</Label>
                    <Input
                      id="deliveryAddressLine1"
                      value={deliveryAddressLine1}
                      onChange={(event) => {
                        setDeliveryAddressLine1(event.target.value);
                        clearFieldError("deliveryAddressLine1");
                      }}
                      aria-invalid={Boolean(fieldErrors.deliveryAddressLine1)}
                    />
                    {fieldErrors.deliveryAddressLine1 && (
                      <p className="text-sm text-red-600">
                        {fieldErrors.deliveryAddressLine1}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deliveryAddressLine2">
                      Address line 2
                    </Label>
                    <Input
                      id="deliveryAddressLine2"
                      value={deliveryAddressLine2}
                      onChange={(event) =>
                        setDeliveryAddressLine2(event.target.value)
                      }
                      placeholder="Optional"
                    />
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="deliveryCity">City</Label>
                      <Input
                        id="deliveryCity"
                        value={deliveryCity}
                        onChange={(event) => setDeliveryCity(event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="deliveryCounty">County</Label>
                      <Input
                        id="deliveryCounty"
                        value={deliveryCounty}
                        onChange={(event) =>
                          setDeliveryCounty(event.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deliveryPostcode">Postcode</Label>
                    <Input
                      id="deliveryPostcode"
                      value={deliveryPostcode}
                      onChange={(event) => {
                        setDeliveryPostcode(event.target.value);
                        clearFieldError("deliveryPostcode");
                      }}
                      aria-invalid={Boolean(fieldErrors.deliveryPostcode)}
                    />
                    {fieldErrors.deliveryPostcode && (
                      <p className="text-sm text-red-600">
                        {fieldErrors.deliveryPostcode}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="deliveryContactName">Contact name</Label>
                      <Input
                        id="deliveryContactName"
                        value={deliveryContactName}
                        onChange={(event) => {
                          setDeliveryContactName(event.target.value);
                          clearFieldError("deliveryContactName");
                        }}
                        aria-invalid={Boolean(fieldErrors.deliveryContactName)}
                      />
                      {fieldErrors.deliveryContactName && (
                        <p className="text-sm text-red-600">
                          {fieldErrors.deliveryContactName}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="deliveryContactPhone">Contact phone</Label>
                      <Input
                        id="deliveryContactPhone"
                        type="tel"
                        value={deliveryContactPhone}
                        onChange={(event) => {
                          setDeliveryContactPhone(event.target.value);
                          clearFieldError("deliveryContactPhone");
                        }}
                        aria-invalid={Boolean(fieldErrors.deliveryContactPhone)}
                      />
                      {fieldErrors.deliveryContactPhone && (
                        <p className="text-sm text-red-600">
                          {fieldErrors.deliveryContactPhone}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="purchaseOrderNumber">Purchase order</Label>
                <Input
                  id="purchaseOrderNumber"
                  value={purchaseOrderNumber}
                  onChange={(event) =>
                    setPurchaseOrderNumber(event.target.value)
                  }
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Additional notes</Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  placeholder="Optional delivery instructions or project notes"
                  className={fieldClassName}
                />
              </div>

              <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
                <h3 className="text-sm font-medium text-neutral-950">
                  Review summary
                </h3>

                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-neutral-500">Project name</dt>
                    <dd className="font-medium text-neutral-950">
                      {projectName}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Project description</dt>
                    <dd className="text-neutral-950">{description}</dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Fulfilment</dt>
                    <dd className="font-medium text-neutral-950">
                      {fulfilmentMethod === "delivery"
                        ? "Delivery"
                        : "Collection"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Required date</dt>
                    <dd className="font-medium text-neutral-950">
                      {formatReviewDate(requestedDate)}
                      {requestedTime ? `, ${requestedTime}` : ""}
                    </dd>
                  </div>

                  {fulfilmentMethod === "delivery" && (
                    <>
                      <div>
                        <dt className="text-neutral-500">Delivery address</dt>
                        <dd className="text-neutral-950">
                          {formatDeliveryAddress(
                            deliveryAddressLine1,
                            deliveryAddressLine2,
                            deliveryCity,
                            deliveryCounty,
                            deliveryPostcode
                          )}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-neutral-500">Contact</dt>
                        <dd className="text-neutral-950">
                          {deliveryContactName} · {deliveryContactPhone}
                        </dd>
                      </div>
                    </>
                  )}

                  {purchaseOrderNumber && (
                    <div>
                      <dt className="text-neutral-500">Purchase order</dt>
                      <dd className="text-neutral-950">
                        {purchaseOrderNumber}
                      </dd>
                    </div>
                  )}

                  {notes && (
                    <div>
                      <dt className="text-neutral-500">Additional notes</dt>
                      <dd className="text-neutral-950">{notes}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {step > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isSubmitting}
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {step < 3 ? (
              <Button type="button" onClick={handleNext}>
                Continue
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit quote request"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
