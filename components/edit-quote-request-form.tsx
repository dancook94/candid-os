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
import { createClient } from "@/lib/supabase/client";

type FulfilmentMethod = "delivery" | "collection";

export type QuoteRequestEditableValues = {
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
};

type QuoteRequestUpdate = {
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
};

type EditQuoteRequestFormProps = {
  quoteRequestId: string;
  canEdit: boolean;
  initialValues: QuoteRequestEditableValues;
  children: React.ReactNode;
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

function toFormValues(values: QuoteRequestEditableValues) {
  return {
    projectName: values.project_name,
    description: values.description,
    fulfilmentMethod: values.fulfilment_method,
    requestedDate: values.requested_date,
    requestedTime: values.requested_time ?? "",
    deliveryAddressLine1: values.delivery_address_line_1 ?? "",
    deliveryAddressLine2: values.delivery_address_line_2 ?? "",
    deliveryCity: values.delivery_city ?? "",
    deliveryCounty: values.delivery_county ?? "",
    deliveryPostcode: values.delivery_postcode ?? "",
    deliveryContactName: values.delivery_contact_name ?? "",
    deliveryContactPhone: values.delivery_contact_phone ?? "",
    purchaseOrderNumber: values.purchase_order_number ?? "",
    notes: values.notes ?? "",
  };
}

export function EditQuoteRequestForm({
  quoteRequestId,
  canEdit,
  initialValues,
  children,
}: EditQuoteRequestFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [projectName, setProjectName] = useState(
    () => toFormValues(initialValues).projectName
  );
  const [description, setDescription] = useState(
    () => toFormValues(initialValues).description
  );
  const [fulfilmentMethod, setFulfilmentMethod] = useState<FulfilmentMethod>(
    () => toFormValues(initialValues).fulfilmentMethod
  );
  const [requestedDate, setRequestedDate] = useState(
    () => toFormValues(initialValues).requestedDate
  );
  const [requestedTime, setRequestedTime] = useState(
    () => toFormValues(initialValues).requestedTime
  );
  const [deliveryAddressLine1, setDeliveryAddressLine1] = useState(
    () => toFormValues(initialValues).deliveryAddressLine1
  );
  const [deliveryAddressLine2, setDeliveryAddressLine2] = useState(
    () => toFormValues(initialValues).deliveryAddressLine2
  );
  const [deliveryCity, setDeliveryCity] = useState(
    () => toFormValues(initialValues).deliveryCity
  );
  const [deliveryCounty, setDeliveryCounty] = useState(
    () => toFormValues(initialValues).deliveryCounty
  );
  const [deliveryPostcode, setDeliveryPostcode] = useState(
    () => toFormValues(initialValues).deliveryPostcode
  );
  const [deliveryContactName, setDeliveryContactName] = useState(
    () => toFormValues(initialValues).deliveryContactName
  );
  const [deliveryContactPhone, setDeliveryContactPhone] = useState(
    () => toFormValues(initialValues).deliveryContactPhone
  );
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(
    () => toFormValues(initialValues).purchaseOrderNumber
  );
  const [notes, setNotes] = useState(() => toFormValues(initialValues).notes);

  const minDate = useMemo(() => getTodayString(), []);

  function resetForm() {
    const values = toFormValues(initialValues);
    setProjectName(values.projectName);
    setDescription(values.description);
    setFulfilmentMethod(values.fulfilmentMethod);
    setRequestedDate(values.requestedDate);
    setRequestedTime(values.requestedTime);
    setDeliveryAddressLine1(values.deliveryAddressLine1);
    setDeliveryAddressLine2(values.deliveryAddressLine2);
    setDeliveryCity(values.deliveryCity);
    setDeliveryCounty(values.deliveryCounty);
    setDeliveryPostcode(values.deliveryPostcode);
    setDeliveryContactName(values.deliveryContactName);
    setDeliveryContactPhone(values.deliveryContactPhone);
    setPurchaseOrderNumber(values.purchaseOrderNumber);
    setNotes(values.notes);
    setFieldErrors({});
    setError("");
  }

  function handleCancel() {
    resetForm();
    setIsEditing(false);
  }

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

  function validateForm() {
    const errors: FieldErrors = {};

    if (!projectName.trim()) {
      errors.projectName = "Project name is required.";
    }

    if (!description.trim()) {
      errors.description = "Project description is required.";
    }

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

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!validateForm()) {
      return;
    }

    setIsSaving(true);

    const isDelivery = fulfilmentMethod === "delivery";

    const updatePayload: QuoteRequestUpdate = {
      project_name: projectName.trim(),
      description: description.trim(),
      fulfilment_method: fulfilmentMethod,
      requested_date: requestedDate,
      requested_time: requestedTime.trim() || null,
      delivery_address_line_1: isDelivery ? deliveryAddressLine1.trim() : null,
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
    };

    const { error: updateError } = await supabase
      .from("quote_requests")
      .update(updatePayload)
      .eq("id", quoteRequestId);

    setIsSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setIsEditing(false);
    router.refresh();
  }

  if (!canEdit) {
    return <>{children}</>;
  }

  if (!isEditing) {
    return (
      <div className="space-y-4">
        {children}
        <Button type="button" onClick={() => setIsEditing(true)}>
          Edit request
        </Button>
      </div>
    );
  }

  return (
    <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardHeader className="border-b border-neutral-200">
        <CardTitle className="text-lg font-semibold text-neutral-950">
          Edit quote request
        </CardTitle>
        <CardDescription>
          Update your project and delivery details.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="editProjectName">Project name</Label>
              <Input
                id="editProjectName"
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  clearFieldError("projectName");
                }}
                aria-invalid={Boolean(fieldErrors.projectName)}
              />
              {fieldErrors.projectName && (
                <p className="text-sm text-red-600">{fieldErrors.projectName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="editDescription">Project description</Label>
              <textarea
                id="editDescription"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  clearFieldError("description");
                }}
                rows={5}
                className={fieldClassName}
                aria-invalid={Boolean(fieldErrors.description)}
              />
              {fieldErrors.description && (
                <p className="text-sm text-red-600">{fieldErrors.description}</p>
              )}
            </div>

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
                <Label htmlFor="editRequestedDate">Required date</Label>
                <Input
                  id="editRequestedDate"
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
                <Label htmlFor="editRequestedTime">Preferred time</Label>
                <Input
                  id="editRequestedTime"
                  value={requestedTime}
                  onChange={(event) => setRequestedTime(event.target.value)}
                  placeholder="e.g. 09:00–12:00"
                />
              </div>
            </div>

            {fulfilmentMethod === "delivery" && (
              <div className="space-y-5 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
                <div className="space-y-2">
                  <Label htmlFor="editDeliveryAddressLine1">Address line 1</Label>
                  <Input
                    id="editDeliveryAddressLine1"
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
                  <Label htmlFor="editDeliveryAddressLine2">Address line 2</Label>
                  <Input
                    id="editDeliveryAddressLine2"
                    value={deliveryAddressLine2}
                    onChange={(event) =>
                      setDeliveryAddressLine2(event.target.value)
                    }
                    placeholder="Optional"
                  />
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editDeliveryCity">City</Label>
                    <Input
                      id="editDeliveryCity"
                      value={deliveryCity}
                      onChange={(event) => setDeliveryCity(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="editDeliveryCounty">County</Label>
                    <Input
                      id="editDeliveryCounty"
                      value={deliveryCounty}
                      onChange={(event) =>
                        setDeliveryCounty(event.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="editDeliveryPostcode">Postcode</Label>
                  <Input
                    id="editDeliveryPostcode"
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
                    <Label htmlFor="editDeliveryContactName">Contact name</Label>
                    <Input
                      id="editDeliveryContactName"
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
                    <Label htmlFor="editDeliveryContactPhone">Contact phone</Label>
                    <Input
                      id="editDeliveryContactPhone"
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

            <div className="space-y-2">
              <Label htmlFor="editPurchaseOrderNumber">Purchase order</Label>
              <Input
                id="editPurchaseOrderNumber"
                value={purchaseOrderNumber}
                onChange={(event) => setPurchaseOrderNumber(event.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editNotes">Additional notes</Label>
              <textarea
                id="editNotes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Optional delivery instructions or project notes"
                className={fieldClassName}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">
                Unable to save changes
              </p>
              <p className="mt-1 text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
