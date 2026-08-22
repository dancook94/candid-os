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
import { QuoteRequestFilePicker } from "@/components/quote-request-file-picker";
import {
  formatCountryLabel,
  formatSavedAddressOption,
  toSavedAddressSnapshot,
} from "@/lib/quote-request/format-address";
import {
  formatAddressOneLine,
  type DeliveryAddressSnapshot,
} from "@/lib/quote-request/normalize-address";
import type { SavedAddressOption } from "@/lib/quote-request/types";
import { cn } from "@/lib/utils";
import { uploadQuoteRequestAttachments } from "@/lib/quote-request-attachments";
import { createClient } from "@/lib/supabase/client";

type FulfilmentMethod = "delivery" | "collection";
type AddressSelection = "saved" | "new" | "";

type QuoteRequestFormProps = {
  companyId: string;
  requestedBy: string;
  companyName: string;
  defaultDeadlineStatus?: string;
  savedAddresses: SavedAddressOption[];
  savedAddressesAvailable: boolean;
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

function formatAddressOption(address: SavedAddressOption) {
  return formatSavedAddressOption(address);
}

function buildNewAddressSnapshot(
  companyName: string,
  values: {
    label: string;
    recipientName: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    county: string;
    postcode: string;
    country: string;
    phone: string;
    deliveryInstructions: string;
  }
): DeliveryAddressSnapshot {
  return {
    label: values.label.trim() || null,
    recipientName: values.recipientName.trim(),
    addressLine1: values.addressLine1.trim(),
    addressLine2: values.addressLine2.trim() || null,
    city: values.city.trim(),
    county: values.county.trim() || null,
    postcode: values.postcode.trim(),
    country: values.country.trim() || "GB",
    phone: values.phone.trim() || null,
    deliveryInstructions: values.deliveryInstructions.trim() || null,
  };
}

export function QuoteRequestForm({
  companyId,
  requestedBy,
  companyName,
  savedAddresses,
  savedAddressesAvailable,
}: QuoteRequestFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const defaultSavedAddressId = savedAddresses.find(
    (address) => address.is_default_delivery
  )?.id;

  const initialAddressSelection: AddressSelection =
    savedAddresses.length > 0 ? "saved" : "new";

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [fulfilmentMethod, setFulfilmentMethod] =
    useState<FulfilmentMethod>("delivery");
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedTime, setRequestedTime] = useState("");

  const [addressSelection, setAddressSelection] = useState<AddressSelection>(
    initialAddressSelection
  );
  const [selectedAddressId, setSelectedAddressId] = useState(
    defaultSavedAddressId ?? savedAddresses[0]?.id ?? ""
  );
  const [saveForFuture, setSaveForFuture] = useState(false);

  const [addressLabel, setAddressLabel] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("GB");
  const [contactPhone, setContactPhone] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");

  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentValidationError, setAttachmentValidationError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");

  const minDate = useMemo(() => getTodayString(), []);

  const selectedSavedAddress = useMemo(
    () => savedAddresses.find((address) => address.id === selectedAddressId),
    [savedAddresses, selectedAddressId]
  );

  const deliverySnapshot = useMemo(() => {
    if (fulfilmentMethod !== "delivery") {
      return null;
    }

    if (addressSelection === "saved" && selectedSavedAddress) {
      return toSavedAddressSnapshot(selectedSavedAddress, companyName);
    }

    if (addressSelection === "new") {
      return buildNewAddressSnapshot(companyName, {
        label: addressLabel,
        recipientName,
        addressLine1,
        addressLine2,
        city,
        county,
        postcode,
        country,
        phone: contactPhone,
        deliveryInstructions,
      });
    }

    return null;
  }, [
    fulfilmentMethod,
    addressSelection,
    selectedSavedAddress,
    companyName,
    addressLabel,
    recipientName,
    addressLine1,
    addressLine2,
    city,
    county,
    postcode,
    country,
    contactPhone,
    deliveryInstructions,
  ]);

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
        if (addressSelection === "saved") {
          if (!selectedAddressId) {
            errors.selectedAddressId = "Select a saved address.";
          }
        } else if (addressSelection === "new") {
          if (!recipientName.trim()) {
            errors.recipientName = "Recipient name is required.";
          }

          if (!addressLine1.trim()) {
            errors.addressLine1 = "Address line 1 is required.";
          }

          if (!city.trim()) {
            errors.city = "City/town is required.";
          }

          if (!postcode.trim()) {
            errors.postcode = "Postcode is required.";
          }

          if (!country.trim()) {
            errors.country = "Country is required.";
          }
        } else {
          errors.addressSelection = "Choose a delivery address option.";
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleNext() {
    setError("");
    setInfoMessage("");

    if (!validateStep(step)) {
      return;
    }

    setStep((current) => Math.min(current + 1, 3));
  }

  function handleBack() {
    setError("");
    setInfoMessage("");
    setStep((current) => Math.max(current - 1, 1));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfoMessage("");

    if (step !== 3) {
      return;
    }

    if (!validateStep(1) || !validateStep(2)) {
      setStep(!projectName.trim() || !description.trim() ? 1 : 2);
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("");

    const payload = {
      projectName: projectName.trim(),
      description: description.trim(),
      fulfilmentMethod,
      requestedDate,
      requestedTime: requestedTime.trim() || null,
      purchaseOrderNumber: purchaseOrderNumber.trim() || null,
      notes: notes.trim() || null,
      delivery:
        fulfilmentMethod === "delivery"
          ? addressSelection === "saved"
            ? {
                mode: "saved" as const,
                savedAddressId: selectedAddressId,
              }
            : {
                mode: "new" as const,
                saveForFuture,
                label: addressLabel.trim() || null,
                recipientName: recipientName.trim(),
                addressLine1: addressLine1.trim(),
                addressLine2: addressLine2.trim() || null,
                city: city.trim(),
                county: county.trim() || null,
                postcode: postcode.trim(),
                country: country.trim() || "GB",
                phone: contactPhone.trim() || null,
                deliveryInstructions: deliveryInstructions.trim() || null,
              }
          : null,
    };

    const response = await fetch("/api/customer/quote-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const submitResult = (await response.json()) as {
      error?: string;
      quoteRequestId?: string;
      message?: string;
      addressReused?: boolean;
    };

    if (!response.ok || !submitResult.quoteRequestId) {
      setIsSubmitting(false);
      setError(submitResult.error ?? "Unable to create quote request.");
      return;
    }

    if (submitResult.addressReused) {
      setInfoMessage("This address is already saved.");
    }

    if (pendingFiles.length > 0) {
      setUploadProgress(`Uploading ${pendingFiles.length} file(s)...`);

      try {
        await uploadQuoteRequestAttachments(supabase, {
          files: pendingFiles,
          companyId,
          quoteRequestId: submitResult.quoteRequestId,
          uploadedBy: requestedBy,
        });
      } catch (uploadError) {
        setIsSubmitting(false);
        setUploadProgress("");
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Unable to upload attachments."
        );
        return;
      }
    }

    await fetch("/api/notifications/quote-request-submitted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteRequestId: submitResult.quoteRequestId }),
    });

    setIsSubmitting(false);
    setUploadProgress("");
    router.push("/quotes");
    router.refresh();
  }

  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="border-b border-border">
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
                {fieldErrors.projectName ? (
                  <p className="text-sm text-red-600">{fieldErrors.projectName}</p>
                ) : null}
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
                {fieldErrors.description ? (
                  <p className="text-sm text-red-600">{fieldErrors.description}</p>
                ) : null}
              </div>
            </div>
          )}

          {step === 2 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Delivery method</Label>
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
                  {fieldErrors.requestedDate ? (
                    <p className="text-sm text-red-600">
                      {fieldErrors.requestedDate}
                    </p>
                  ) : null}
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

              {fulfilmentMethod === "delivery" ? (
                <div className="space-y-5 rounded-xl border border-border bg-muted/35 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="deliveryAddress">Delivery address</Label>

                    {!savedAddressesAvailable ? (
                      <p className="text-sm text-muted-foreground">
                        Saved addresses require the proposed database migration.
                        Enter an address below.
                      </p>
                    ) : savedAddresses.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No saved addresses yet. Enter an address below.
                      </p>
                    ) : (
                      <select
                        id="deliveryAddress"
                        className={fieldClassName}
                        value={
                          addressSelection === "new"
                            ? "new"
                            : selectedAddressId || ""
                        }
                        onChange={(event) => {
                          const value = event.target.value;

                          if (value === "new") {
                            setAddressSelection("new");
                            clearFieldError("selectedAddressId");
                            return;
                          }

                          setAddressSelection("saved");
                          setSelectedAddressId(value);
                          clearFieldError("selectedAddressId");
                        }}
                      >
                        <option value="">Select a saved address</option>
                        {savedAddresses.map((address) => (
                          <option key={address.id} value={address.id}>
                            {formatAddressOption(address)}
                            {address.is_default_delivery ? " (Default)" : ""}
                          </option>
                        ))}
                        <option value="new">Enter a new address</option>
                      </select>
                    )}

                    {fieldErrors.selectedAddressId ? (
                      <p className="text-sm text-red-600">
                        {fieldErrors.selectedAddressId}
                      </p>
                    ) : null}
                    {fieldErrors.addressSelection ? (
                      <p className="text-sm text-red-600">
                        {fieldErrors.addressSelection}
                      </p>
                    ) : null}
                  </div>

                  {addressSelection === "saved" && deliverySnapshot ? (
                    <div className="rounded-xl border border-border bg-background p-4 text-sm">
                      <p className="font-medium text-foreground">
                        {deliverySnapshot.label || "Saved address"}
                        {selectedSavedAddress?.is_default_delivery
                          ? " · Default"
                          : ""}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-muted-foreground">
                        {[
                          deliverySnapshot.recipientName,
                          companyName,
                          deliverySnapshot.addressLine1,
                          deliverySnapshot.addressLine2,
                          deliverySnapshot.city,
                          deliverySnapshot.county,
                          deliverySnapshot.postcode,
                          formatCountryLabel(deliverySnapshot.country),
                          deliverySnapshot.phone,
                          deliverySnapshot.deliveryInstructions,
                        ]
                          .filter(Boolean)
                          .join("\n")}
                      </p>
                    </div>
                  ) : null}

                  {addressSelection === "new" ||
                  !savedAddressesAvailable ||
                  savedAddresses.length === 0 ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="addressLabel">Address label</Label>
                        <Input
                          id="addressLabel"
                          value={addressLabel}
                          onChange={(event) => setAddressLabel(event.target.value)}
                          placeholder="Head office"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="recipientName">Recipient name</Label>
                        <Input
                          id="recipientName"
                          value={recipientName}
                          onChange={(event) => {
                            setRecipientName(event.target.value);
                            clearFieldError("recipientName");
                          }}
                          aria-invalid={Boolean(fieldErrors.recipientName)}
                        />
                        {fieldErrors.recipientName ? (
                          <p className="text-sm text-red-600">
                            {fieldErrors.recipientName}
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="addressLine1">Address line 1</Label>
                        <Input
                          id="addressLine1"
                          value={addressLine1}
                          onChange={(event) => {
                            setAddressLine1(event.target.value);
                            clearFieldError("addressLine1");
                          }}
                          aria-invalid={Boolean(fieldErrors.addressLine1)}
                        />
                        {fieldErrors.addressLine1 ? (
                          <p className="text-sm text-red-600">
                            {fieldErrors.addressLine1}
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="addressLine2">Address line 2</Label>
                        <Input
                          id="addressLine2"
                          value={addressLine2}
                          onChange={(event) => setAddressLine2(event.target.value)}
                          placeholder="Optional"
                        />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="city">City/town</Label>
                          <Input
                            id="city"
                            value={city}
                            onChange={(event) => {
                              setCity(event.target.value);
                              clearFieldError("city");
                            }}
                            aria-invalid={Boolean(fieldErrors.city)}
                          />
                          {fieldErrors.city ? (
                            <p className="text-sm text-red-600">{fieldErrors.city}</p>
                          ) : null}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="county">County</Label>
                          <Input
                            id="county"
                            value={county}
                            onChange={(event) => setCounty(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="postcode">Postcode</Label>
                          <Input
                            id="postcode"
                            value={postcode}
                            onChange={(event) => {
                              setPostcode(event.target.value);
                              clearFieldError("postcode");
                            }}
                            aria-invalid={Boolean(fieldErrors.postcode)}
                          />
                          {fieldErrors.postcode ? (
                            <p className="text-sm text-red-600">
                              {fieldErrors.postcode}
                            </p>
                          ) : null}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="country">Country</Label>
                          <Input
                            id="country"
                            value={country === "GB" ? "United Kingdom" : country}
                            onChange={(event) => {
                              const value = event.target.value;

                              setCountry(
                                value.toLowerCase().includes("united kingdom")
                                  ? "GB"
                                  : value
                              );
                              clearFieldError("country");
                            }}
                            aria-invalid={Boolean(fieldErrors.country)}
                          />
                          {fieldErrors.country ? (
                            <p className="text-sm text-red-600">
                              {fieldErrors.country}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contactPhone">Contact phone</Label>
                        <Input
                          id="contactPhone"
                          type="tel"
                          value={contactPhone}
                          onChange={(event) => setContactPhone(event.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="deliveryInstructions">
                          Delivery instructions
                        </Label>
                        <textarea
                          id="deliveryInstructions"
                          value={deliveryInstructions}
                          onChange={(event) =>
                            setDeliveryInstructions(event.target.value)
                          }
                          rows={3}
                          className={fieldClassName}
                        />
                      </div>

                      {savedAddressesAvailable ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={saveForFuture}
                            onChange={(event) =>
                              setSaveForFuture(event.target.checked)
                            }
                          />
                          Save this address for future quote requests
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="purchaseOrderNumber">Purchase order</Label>
                <Input
                  id="purchaseOrderNumber"
                  value={purchaseOrderNumber}
                  onChange={(event) => setPurchaseOrderNumber(event.target.value)}
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
                  placeholder="Optional project notes"
                  className={fieldClassName}
                />
              </div>

              <QuoteRequestFilePicker
                files={pendingFiles}
                onFilesChange={setPendingFiles}
                disabled={isSubmitting}
                onValidationError={setAttachmentValidationError}
              />

              {attachmentValidationError ? (
                <p className="text-sm text-red-600">{attachmentValidationError}</p>
              ) : null}

              <div className="rounded-xl border border-border bg-muted/35 p-4">
                <h3 className="text-sm font-medium text-neutral-950">
                  Review summary
                </h3>

                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-neutral-500">Project name</dt>
                    <dd className="font-medium text-neutral-950">{projectName}</dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Project description</dt>
                    <dd className="text-neutral-950">{description}</dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Delivery method</dt>
                    <dd className="font-medium text-neutral-950">
                      {fulfilmentMethod === "delivery" ? "Delivery" : "Collection"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-neutral-500">Required date</dt>
                    <dd className="font-medium text-neutral-950">
                      {formatReviewDate(requestedDate)}
                      {requestedTime ? `, ${requestedTime}` : ""}
                    </dd>
                  </div>

                  {fulfilmentMethod === "delivery" && deliverySnapshot ? (
                    <>
                      <div>
                        <dt className="text-neutral-500">Delivery address</dt>
                        <dd className="whitespace-pre-line text-neutral-950">
                          {[
                            deliverySnapshot.label,
                            deliverySnapshot.recipientName,
                            formatAddressOneLine(deliverySnapshot),
                            formatCountryLabel(deliverySnapshot.country),
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        </dd>
                      </div>

                      {deliverySnapshot.phone ? (
                        <div>
                          <dt className="text-neutral-500">Contact phone</dt>
                          <dd className="text-neutral-950">
                            {deliverySnapshot.phone}
                          </dd>
                        </div>
                      ) : null}

                      {addressSelection === "new" && saveForFuture ? (
                        <div>
                          <dt className="text-neutral-500">Saved address</dt>
                          <dd className="text-neutral-950">
                            Will be saved for future quote requests
                          </dd>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {purchaseOrderNumber ? (
                    <div>
                      <dt className="text-neutral-500">Purchase order</dt>
                      <dd className="text-neutral-950">{purchaseOrderNumber}</dd>
                    </div>
                  ) : null}

                  {notes ? (
                    <div>
                      <dt className="text-neutral-500">Additional notes</dt>
                      <dd className="text-neutral-950">{notes}</dd>
                    </div>
                  ) : null}

                  {pendingFiles.length > 0 ? (
                    <div>
                      <dt className="text-neutral-500">Attachments</dt>
                      <dd className="text-neutral-950">
                        {pendingFiles.length} file
                        {pendingFiles.length === 1 ? "" : "s"} ready to upload
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          ) : null}

          {infoMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-800">{infoMessage}</p>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">
                Unable to submit quote request
              </p>
              <p className="mt-1 text-sm text-red-700">{error}</p>
            </div>
          ) : null}

          {uploadProgress ? (
            <p className="text-sm text-neutral-600">{uploadProgress}</p>
          ) : null}

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
                {isSubmitting
                  ? uploadProgress || "Submitting..."
                  : "Submit quote request"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
