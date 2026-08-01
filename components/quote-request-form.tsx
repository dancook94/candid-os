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

type FulfillmentType = "delivery" | "collection";

type QuoteRequestInsert = {
  company_id: string;
  requested_by: string;
  project_name: string;
  project_description: string;
  fulfillment_type: FulfillmentType;
  required_date: string;
  required_time: string | null;
  delivery_address: string | null;
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  purchase_order_number: string | null;
  notes: string | null;
  status: "draft";
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
  const [projectDescription, setProjectDescription] = useState("");
  const [fulfillmentType, setFulfillmentType] =
    useState<FulfillmentType>("delivery");
  const [requiredDate, setRequiredDate] = useState("");
  const [requiredTime, setRequiredTime] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryContactName, setDeliveryContactName] = useState("");
  const [deliveryContactPhone, setDeliveryContactPhone] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

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

      if (!projectDescription.trim()) {
        errors.projectDescription = "Project description is required.";
      }
    }

    if (currentStep === 2) {
      if (!requiredDate) {
        errors.requiredDate = "Required date is required.";
      } else if (requiredDate < minDate) {
        errors.requiredDate = "Required date cannot be in the past.";
      }

      if (fulfillmentType === "delivery") {
        if (!deliveryAddress.trim()) {
          errors.deliveryAddress = "Delivery address is required.";
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

    if (!validateStep(1) || !validateStep(2)) {
      setStep(!projectName.trim() || !projectDescription.trim() ? 1 : 2);
      return;
    }

    setIsSubmitting(true);

    const insertPayload: QuoteRequestInsert = {
      company_id: companyId,
      requested_by: requestedBy,
      project_name: projectName.trim(),
      project_description: projectDescription.trim(),
      fulfillment_type: fulfillmentType,
      required_date: requiredDate,
      required_time: requiredTime.trim() || null,
      delivery_address:
        fulfillmentType === "delivery" ? deliveryAddress.trim() : null,
      delivery_contact_name:
        fulfillmentType === "delivery" ? deliveryContactName.trim() : null,
      delivery_contact_phone:
        fulfillmentType === "delivery" ? deliveryContactPhone.trim() : null,
      purchase_order_number: purchaseOrderNumber.trim() || null,
      notes: additionalNotes.trim() || null,
      status: "draft",
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
                <Label htmlFor="projectDescription">Project description</Label>
                <textarea
                  id="projectDescription"
                  value={projectDescription}
                  onChange={(event) => {
                    setProjectDescription(event.target.value);
                    clearFieldError("projectDescription");
                  }}
                  rows={5}
                  placeholder="Describe the project scope, quantities, and specifications."
                  className={fieldClassName}
                  aria-invalid={Boolean(fieldErrors.projectDescription)}
                />
                {fieldErrors.projectDescription && (
                  <p className="text-sm text-red-600">
                    {fieldErrors.projectDescription}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Fulfillment</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["delivery", "collection"] as const).map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={
                        fulfillmentType === option ? "default" : "outline"
                      }
                      onClick={() => {
                        setFulfillmentType(option);
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
                  <Label htmlFor="requiredDate">Required date</Label>
                  <Input
                    id="requiredDate"
                    type="date"
                    min={minDate}
                    value={requiredDate}
                    onChange={(event) => {
                      setRequiredDate(event.target.value);
                      clearFieldError("requiredDate");
                    }}
                    aria-invalid={Boolean(fieldErrors.requiredDate)}
                  />
                  {fieldErrors.requiredDate && (
                    <p className="text-sm text-red-600">
                      {fieldErrors.requiredDate}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="requiredTime">Preferred time</Label>
                  <Input
                    id="requiredTime"
                    value={requiredTime}
                    onChange={(event) => setRequiredTime(event.target.value)}
                    placeholder="e.g. 09:00–12:00"
                  />
                </div>
              </div>

              {fulfillmentType === "delivery" && (
                <div className="space-y-5 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="deliveryAddress">Delivery address</Label>
                    <textarea
                      id="deliveryAddress"
                      value={deliveryAddress}
                      onChange={(event) => {
                        setDeliveryAddress(event.target.value);
                        clearFieldError("deliveryAddress");
                      }}
                      rows={3}
                      className={fieldClassName}
                      aria-invalid={Boolean(fieldErrors.deliveryAddress)}
                    />
                    {fieldErrors.deliveryAddress && (
                      <p className="text-sm text-red-600">
                        {fieldErrors.deliveryAddress}
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
                <Label htmlFor="additionalNotes">Additional notes</Label>
                <textarea
                  id="additionalNotes"
                  value={additionalNotes}
                  onChange={(event) => setAdditionalNotes(event.target.value)}
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
                    <dd className="text-neutral-950">{projectDescription}</dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Fulfillment</dt>
                    <dd className="font-medium text-neutral-950">
                      {fulfillmentType === "delivery"
                        ? "Delivery"
                        : "Collection"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Required date</dt>
                    <dd className="font-medium text-neutral-950">
                      {formatReviewDate(requiredDate)}
                      {requiredTime ? `, ${requiredTime}` : ""}
                    </dd>
                  </div>

                  {fulfillmentType === "delivery" && (
                    <>
                      <div>
                        <dt className="text-neutral-500">Delivery address</dt>
                        <dd className="text-neutral-950">{deliveryAddress}</dd>
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

                  {additionalNotes && (
                    <div>
                      <dt className="text-neutral-500">Additional notes</dt>
                      <dd className="text-neutral-950">{additionalNotes}</dd>
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
