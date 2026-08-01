"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { QuoteBuilderLineItemCard } from "@/components/quote-builder-line-item";
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
import {
  deleteOrphanedQuoteItemImages,
  formatSupabaseStorageError,
  syncQuoteVersionItemImages,
  toQuoteItemImageInsertFields,
  type QuoteItemImageMetadata,
} from "@/lib/quote-item-images";

const VAT_RATE = 0.2;

type LineItemFormState = {
  clientKey: string;
  id?: string;
  title: string;
  description: string;
  quantity: string;
  unitPrice: string;
  isOptional: boolean;
  isSelected: boolean;
  imageStoragePath: string | null;
  imageFileName: string | null;
  imageFileType: string | null;
  imageFileSize: number | null;
  pendingFile: File | null;
  previewUrl: string | null;
  imageRemoved: boolean;
  previousStoragePath: string | null;
};

export type QuoteBuilderLineItem = {
  id?: string;
  title: string;
  description: string;
  quantity: number;
  unitPrice: number;
  isOptional: boolean;
  isSelected?: boolean;
  imageStoragePath?: string | null;
  imageFileName?: string | null;
  imageFileType?: string | null;
  imageFileSize?: number | null;
  imagePreviewUrl?: string | null;
};

export type QuoteBuilderInitialValues = {
  companyId: string;
  quoteRequestId: string | null;
  projectName: string;
  expiryDate: string;
  paymentTermsDays: number;
  introduction: string;
  customerNotes: string;
  internalNotes: string;
  lineItems: QuoteBuilderLineItem[];
};

type CompanyOption = {
  id: string;
  company_name: string;
};

type QuoteRequestOption = {
  id: string;
  company_id: string;
  project_name: string;
};

type QuoteBuilderFormProps = {
  mode: "create" | "edit";
  createdBy: string;
  companies: CompanyOption[];
  quoteRequests: QuoteRequestOption[];
  initialValues: QuoteBuilderInitialValues;
  quoteId?: string;
  selectedQuoteVersionId?: string;
  quoteNumber?: number;
  quoteStatus?: string;
  versionStatus?: string;
  selectedVersionNumber?: number;
  currentVersionNumber?: number;
  canEdit?: boolean;
};

function formatSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Unable to save quote.";
  }

  const parts = [
    "message" in error && typeof error.message === "string"
      ? error.message
      : null,
    "details" in error && typeof error.details === "string"
      ? error.details
      : null,
    "hint" in error && typeof error.hint === "string" ? error.hint : null,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" — ");
  }

  return "Unable to save quote.";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(roundMoney(value));
}

function revokeIfBlob(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function createEmptyLineItem(clientKey: string): LineItemFormState {
  return {
    clientKey,
    title: "",
    description: "",
    quantity: "1",
    unitPrice: "0.00",
    isOptional: false,
    isSelected: true,
    imageStoragePath: null,
    imageFileName: null,
    imageFileType: null,
    imageFileSize: null,
    pendingFile: null,
    previewUrl: null,
    imageRemoved: false,
    previousStoragePath: null,
  };
}

function toLineItemFormState(
  item: QuoteBuilderLineItem,
  index: number
): LineItemFormState {
  return {
    clientKey: item.id ?? `new-${index}`,
    id: item.id,
    title: item.title,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: item.unitPrice.toFixed(2),
    isOptional: item.isOptional,
    isSelected: item.isSelected ?? true,
    imageStoragePath: item.imageStoragePath ?? null,
    imageFileName: item.imageFileName ?? null,
    imageFileType: item.imageFileType ?? null,
    imageFileSize: item.imageFileSize ?? null,
    pendingFile: null,
    previewUrl: item.imagePreviewUrl ?? null,
    imageRemoved: false,
    previousStoragePath: item.imageStoragePath ?? null,
  };
}

function getPreservedImageMetadata(
  item: Pick<
    LineItemFormState,
    | "pendingFile"
    | "imageRemoved"
    | "imageStoragePath"
    | "imageFileName"
    | "imageFileType"
    | "imageFileSize"
  >
): QuoteItemImageMetadata | null {
  if (item.pendingFile || item.imageRemoved || !item.imageStoragePath) {
    return null;
  }

  return {
    image_storage_path: item.imageStoragePath,
    image_file_name: item.imageFileName,
    image_file_type: item.imageFileType,
    image_file_size: item.imageFileSize,
  };
}

function getImageInsertFields(
  item: Pick<
    LineItemFormState,
    | "pendingFile"
    | "imageRemoved"
    | "imageStoragePath"
    | "imageFileName"
    | "imageFileType"
    | "imageFileSize"
  >
) {
  return toQuoteItemImageInsertFields(getPreservedImageMetadata(item));
}

function buildItemsPayload(
  activeItems: ReturnType<typeof calculateTotals>["parsedItems"]
) {
  return activeItems.map((item, index) => ({
    title: item.title.trim(),
    description: item.description.trim() || null,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    is_optional: item.isOptional,
    line_total: item.lineTotal,
    sort_order: index + 1,
    ...getImageInsertFields(item),
  }));
}

function formatSaveError(error: unknown) {
  const storageMessage = formatSupabaseStorageError(error);

  if (
    storageMessage &&
    storageMessage !== "Unable to process quote item image."
  ) {
    return storageMessage;
  }

  return formatSupabaseError(error);
}

async function syncSavedLineItemImages(
  supabase: ReturnType<typeof createClient>,
  quoteId: string,
  quoteVersionId: string,
  activeItems: ReturnType<typeof calculateTotals>["parsedItems"],
  insertedItems: { id: string; sort_order: number }[]
) {
  const syncInputs = activeItems.map((item, index) => {
    const savedItem = insertedItems.find(
      (inserted) => inserted.sort_order === index + 1
    );

    if (!savedItem) {
      throw new Error(
        `Unable to match saved line item for sort order ${index + 1}.`
      );
    }

    return {
      quoteItemId: savedItem.id,
      pendingFile: item.pendingFile,
      imageRemoved: item.imageRemoved,
      preservedMetadata: getPreservedImageMetadata(item),
      previousStoragePath: item.previousStoragePath,
    };
  });

  return syncQuoteVersionItemImages(
    supabase,
    quoteId,
    quoteVersionId,
    syncInputs
  );
}

function calculateLineTotal(quantity: number, unitPrice: number) {
  return roundMoney(quantity * unitPrice);
}

function calculateTotals(lineItems: LineItemFormState[]) {
  const parsedItems = lineItems.map((item) => {
    const quantity = Number.parseFloat(item.quantity) || 0;
    const unitPrice = Number.parseFloat(item.unitPrice) || 0;
    const lineTotal = calculateLineTotal(quantity, unitPrice);

    return {
      ...item,
      quantity,
      unitPrice,
      lineTotal,
    };
  });

  const subtotal = roundMoney(
    parsedItems
      .filter((item) => !item.isOptional)
      .reduce((sum, item) => sum + item.lineTotal, 0)
  );
  const vatAmount = roundMoney(subtotal * VAT_RATE);
  const total = roundMoney(subtotal + vatAmount);

  return { parsedItems, subtotal, vatAmount, total };
}

export function QuoteBuilderForm({
  mode,
  createdBy,
  companies,
  quoteRequests,
  initialValues,
  quoteId,
  selectedQuoteVersionId,
  quoteNumber,
  quoteStatus,
  versionStatus,
  selectedVersionNumber,
  currentVersionNumber,
  canEdit = true,
}: QuoteBuilderFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [companyId, setCompanyId] = useState(initialValues.companyId);
  const [quoteRequestId, setQuoteRequestId] = useState(
    initialValues.quoteRequestId ?? ""
  );
  const [projectName, setProjectName] = useState(initialValues.projectName);
  const [expiryDate, setExpiryDate] = useState(initialValues.expiryDate);
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    String(initialValues.paymentTermsDays)
  );
  const [introduction, setIntroduction] = useState(initialValues.introduction);
  const [customerNotes, setCustomerNotes] = useState(
    initialValues.customerNotes
  );
  const [internalNotes, setInternalNotes] = useState(
    initialValues.internalNotes
  );
  const [lineItems, setLineItems] = useState<LineItemFormState[]>(() =>
    initialValues.lineItems.length > 0
      ? initialValues.lineItems.map((item, index) =>
          toLineItemFormState(item, index)
        )
      : [createEmptyLineItem("new-0")]
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [focusTitleClientKey, setFocusTitleClientKey] = useState<string | null>(
    null
  );

  const isBusy = isSaving || isSending;

  const totals = useMemo(() => calculateTotals(lineItems), [lineItems]);

  const filteredQuoteRequests = quoteRequests.filter(
    (request) => !companyId || request.company_id === companyId
  );

  const isReadOnly = !canEdit;

  const lineItemsRef = useRef(lineItems);
  lineItemsRef.current = lineItems;

  useEffect(() => {
    return () => {
      for (const item of lineItemsRef.current) {
        revokeIfBlob(item.previewUrl);
      }
    };
  }, []);

  function handleAddLineItem() {
    const clientKey = crypto.randomUUID();
    setLineItems((current) => [...current, createEmptyLineItem(clientKey)]);
    setFocusTitleClientKey(clientKey);
  }

  function handleRemoveLineItem(clientKey: string) {
    setLineItems((current) => {
      if (current.length <= 1) {
        return current;
      }

      const removedItem = current.find((item) => item.clientKey === clientKey);
      revokeIfBlob(removedItem?.previewUrl ?? null);

      return current.filter((item) => item.clientKey !== clientKey);
    });
  }

  function handleDuplicateLineItem(clientKey: string) {
    setLineItems((current) => {
      const sourceIndex = current.findIndex((item) => item.clientKey === clientKey);

      if (sourceIndex === -1) {
        return current;
      }

      const source = current[sourceIndex];
      const duplicate: LineItemFormState = {
        clientKey: crypto.randomUUID(),
        title: source.title,
        description: source.description,
        quantity: source.quantity,
        unitPrice: source.unitPrice,
        isOptional: source.isOptional,
        isSelected: source.isSelected,
        imageStoragePath: source.imageStoragePath,
        imageFileName: source.imageFileName,
        imageFileType: source.imageFileType,
        imageFileSize: source.imageFileSize,
        pendingFile: source.pendingFile,
        previewUrl: source.pendingFile
          ? URL.createObjectURL(source.pendingFile)
          : source.previewUrl,
        imageRemoved: false,
        previousStoragePath: source.imageStoragePath,
      };

      const next = [...current];
      next.splice(sourceIndex + 1, 0, duplicate);
      return next;
    });
  }

  function handleMoveLineItem(clientKey: string, direction: -1 | 1) {
    setLineItems((current) => {
      const index = current.findIndex((item) => item.clientKey === clientKey);

      if (index === -1) {
        return current;
      }

      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = current.map((item) => ({ ...item }));
      const [movedItem] = next.splice(index, 1);
      next.splice(targetIndex, 0, movedItem);
      return next;
    });
  }

  const clearFocusTitle = useCallback(() => {
    setFocusTitleClientKey(null);
  }, []);

  function handleSelectLineItemImage(clientKey: string, file: File) {
    setLineItems((current) =>
      current.map((item) => {
        if (item.clientKey !== clientKey) {
          return item;
        }

        revokeIfBlob(item.previewUrl);

        return {
          ...item,
          pendingFile: file,
          imageRemoved: false,
          imageFileName: file.name,
          previewUrl: URL.createObjectURL(file),
        };
      })
    );
  }

  function handleRemoveLineItemImage(clientKey: string) {
    setLineItems((current) =>
      current.map((item) => {
        if (item.clientKey !== clientKey) {
          return item;
        }

        revokeIfBlob(item.previewUrl);

        return {
          ...item,
          pendingFile: null,
          previewUrl: null,
          imageFileName: null,
          imageStoragePath: null,
          imageFileType: null,
          imageFileSize: null,
          imageRemoved: true,
        };
      })
    );
  }

  function updateLineItem(
    clientKey: string,
    updates: Partial<LineItemFormState>
  ) {
    setLineItems((current) =>
      current.map((item) =>
        item.clientKey === clientKey ? { ...item, ...updates } : item
      )
    );
  }

  async function getNextQuoteNumber() {
    const { data, error: quoteNumberError } = await supabase
      .from("quotes")
      .select("quote_number")
      .order("quote_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (quoteNumberError) {
      throw new Error(quoteNumberError.message);
    }

    return (data?.quote_number ?? 0) + 1;
  }

  async function rollbackCreatedQuote(
    quoteIdToRemove: string,
    versionIdToRemove: string
  ) {
    await supabase
      .from("quote_items")
      .delete()
      .eq("quote_version_id", versionIdToRemove);
    await supabase.from("quote_versions").delete().eq("id", versionIdToRemove);
    await supabase.from("quotes").delete().eq("id", quoteIdToRemove);
  }

  async function persistQuote(targetStatus: "draft" | "sent") {
    if (isReadOnly) {
      return;
    }

    setError("");
    setSuccess("");

    const trimmedProjectName = projectName.trim();

    if (!companyId) {
      setError("Company is required.");
      return;
    }

    if (!trimmedProjectName) {
      setError("Project name is required.");
      return;
    }

    const parsedPaymentTerms = Number.parseInt(paymentTermsDays, 10);

    if (!Number.isFinite(parsedPaymentTerms) || parsedPaymentTerms < 0) {
      setError("Payment terms must be a valid number of days.");
      return;
    }

    for (const item of lineItems) {
      const hasContent =
        item.title.trim() ||
        item.description.trim() ||
        item.quantity !== "1" ||
        item.unitPrice !== "0.00" ||
        item.isOptional;

      if (hasContent && !item.title.trim()) {
        setError("Each line item must have a title.");
        return;
      }
    }

    const activeItems = totals.parsedItems.filter((item) => item.title.trim());

    if (targetStatus === "sent") {
      setIsSending(true);
    } else {
      setIsSaving(true);
    }

    try {
      const versionFields = {
        version_status: targetStatus,
        expiry_date: expiryDate || null,
        payment_terms_days: parsedPaymentTerms,
        introduction: introduction.trim() || null,
        customer_notes: customerNotes.trim() || null,
        internal_notes: internalNotes.trim() || null,
        subtotal: totals.subtotal,
        vat_rate: VAT_RATE,
        vat_amount: totals.vatAmount,
        total: totals.total,
      };

      const itemsPayload = buildItemsPayload(activeItems);

      if (mode === "create") {
        if (targetStatus !== "draft") {
          throw new Error("Save the quote as a draft before sending.");
        }

        const nextQuoteNumber = await getNextQuoteNumber();

        const { data: createdQuote, error: quoteError } = await supabase
          .from("quotes")
          .insert({
            quote_number: nextQuoteNumber,
            company_id: companyId,
            quote_request_id: quoteRequestId || null,
            project_name: trimmedProjectName,
            status: "draft",
            current_version: 1,
            created_by: createdBy,
          })
          .select("id")
          .single();

        if (quoteError || !createdQuote) {
          throw new Error(quoteError?.message ?? "Unable to create quote.");
        }

        const { data: createdVersion, error: versionError } = await supabase
          .from("quote_versions")
          .insert({
            quote_id: createdQuote.id,
            version_number: 1,
            ...versionFields,
          })
          .select("id")
          .single();

        if (versionError || !createdVersion) {
          await supabase.from("quotes").delete().eq("id", createdQuote.id);
          throw new Error(
            versionError?.message ?? "Unable to create quote version."
          );
        }

        if (itemsPayload.length > 0) {
          const { data: insertedItems, error: itemsError } = await supabase
            .from("quote_items")
            .insert(
              itemsPayload.map((item) => ({
                ...item,
                quote_version_id: createdVersion.id,
              }))
            )
            .select("id, sort_order");

          if (itemsError) {
            await rollbackCreatedQuote(createdQuote.id, createdVersion.id);
            throw itemsError;
          }

          const retainedPaths = await syncSavedLineItemImages(
            supabase,
            createdQuote.id,
            createdVersion.id,
            activeItems,
            insertedItems ?? []
          );

          const previousPaths = activeItems
            .map((item) => item.previousStoragePath)
            .filter((path): path is string => Boolean(path));

          await deleteOrphanedQuoteItemImages(
            supabase,
            previousPaths,
            retainedPaths
          );
        }

        if (quoteRequestId) {
          const { error: requestUpdateError } = await supabase
            .from("quote_requests")
            .update({ request_status: "quoted" })
            .eq("id", quoteRequestId);

          if (requestUpdateError) {
            await rollbackCreatedQuote(createdQuote.id, createdVersion.id);
            throw new Error(requestUpdateError.message);
          }
        }

        router.push(`/admin/quotes/${createdQuote.id}`);
        router.refresh();
        return;
      }

      if (!quoteId || !selectedQuoteVersionId) {
        throw new Error("Quote details are missing.");
      }

      if (versionStatus !== "draft") {
        throw new Error("Only draft versions can be saved.");
      }

      if (targetStatus === "sent") {
        const { error: supersedeError } = await supabase
          .from("quote_versions")
          .update({ version_status: "superseded" })
          .eq("quote_id", quoteId)
          .eq("version_status", "sent")
          .neq("id", selectedQuoteVersionId);

        if (supersedeError) {
          throw supersedeError;
        }
      }

      const { data: existingItems, error: existingItemsError } = await supabase
        .from("quote_items")
        .select("id, image_storage_path")
        .eq("quote_version_id", selectedQuoteVersionId);

      if (existingItemsError) {
        throw existingItemsError;
      }

      const previousStoragePaths = (existingItems ?? [])
        .map((item) => item.image_storage_path)
        .filter((path): path is string => Boolean(path));

      const { error: quoteUpdateError } = await supabase
        .from("quotes")
        .update({
          company_id: companyId,
          quote_request_id: quoteRequestId || null,
          project_name: trimmedProjectName,
          status: targetStatus,
          ...(targetStatus === "sent" && selectedVersionNumber !== undefined
            ? { current_version: selectedVersionNumber }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", quoteId);

      if (quoteUpdateError) {
        throw quoteUpdateError;
      }

      const { error: versionUpdateError } = await supabase
        .from("quote_versions")
        .update(versionFields)
        .eq("id", selectedQuoteVersionId);

      if (versionUpdateError) {
        throw versionUpdateError;
      }

      const { error: deleteItemsError } = await supabase
        .from("quote_items")
        .delete()
        .eq("quote_version_id", selectedQuoteVersionId);

      if (deleteItemsError) {
        throw deleteItemsError;
      }

      if (itemsPayload.length > 0) {
        const { data: insertedItems, error: itemsError } = await supabase
          .from("quote_items")
          .insert(
            itemsPayload.map((item) => ({
              ...item,
              quote_version_id: selectedQuoteVersionId,
            }))
          )
          .select("id, sort_order");

        if (itemsError) {
          throw itemsError;
        }

        const retainedPaths = await syncSavedLineItemImages(
          supabase,
          quoteId,
          selectedQuoteVersionId,
          activeItems,
          insertedItems ?? []
        );

        await deleteOrphanedQuoteItemImages(
          supabase,
          previousStoragePaths,
          retainedPaths
        );
      } else if (previousStoragePaths.length > 0) {
        await deleteOrphanedQuoteItemImages(
          supabase,
          previousStoragePaths,
          new Set()
        );
      }

      if (targetStatus === "sent") {
        setSuccess("Quote sent successfully.");
      } else {
        setSuccess("Draft saved successfully.");
      }

      router.refresh();
    } catch (saveError) {
      setError(formatSaveError(saveError));
    } finally {
      setIsSaving(false);
      setIsSending(false);
    }
  }

  async function handleSaveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistQuote("draft");
  }

  async function handleSendQuote() {
    await persistQuote("sent");
  }

  return (
    <form className="space-y-6" onSubmit={handleSaveDraft}>
      <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
        <CardHeader className="border-b border-neutral-200">
          <CardTitle className="text-lg font-semibold text-neutral-950">
            {mode === "create" ? "New quote" : "Quote details"}
          </CardTitle>
          <CardDescription>
            {mode === "create"
              ? "Create a draft quote with line items and customer details."
              : isReadOnly
                ? "This version is read-only."
                : "Edit this draft version."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          {mode === "edit" && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-500">
              {quoteStatus && (
                <p>
                  Quote status:{" "}
                  <span className="font-medium capitalize text-neutral-950">
                    {quoteStatus}
                  </span>
                </p>
              )}
              {versionStatus && selectedVersionNumber !== undefined && (
                <p>
                  Version {selectedVersionNumber}
                  {currentVersionNumber !== undefined &&
                    selectedVersionNumber !== currentVersionNumber &&
                    ` (current: v${currentVersionNumber})`}
                  :{" "}
                  <span className="font-medium capitalize text-neutral-950">
                    {versionStatus}
                  </span>
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company-id">Company</Label>
              <select
                id="company-id"
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  setQuoteRequestId("");
                }}
                disabled={isBusy || isReadOnly}
                className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
                required
              >
                <option value="">Select company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote-request-id">Linked quote request</Label>
              <select
                id="quote-request-id"
                value={quoteRequestId}
                onChange={(event) => setQuoteRequestId(event.target.value)}
                disabled={isBusy || isReadOnly || !companyId}
                className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
              >
                <option value="">No linked request</option>
                {filteredQuoteRequests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.project_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                disabled={isBusy || isReadOnly}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry-date">Expiry date</Label>
              <Input
                id="expiry-date"
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
                disabled={isBusy || isReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment-terms">Payment terms (days)</Label>
              <Input
                id="payment-terms"
                type="number"
                min={0}
                value={paymentTermsDays}
                onChange={(event) => setPaymentTermsDays(event.target.value)}
                disabled={isBusy || isReadOnly}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="introduction">Introduction</Label>
              <textarea
                id="introduction"
                value={introduction}
                onChange={(event) => setIntroduction(event.target.value)}
                disabled={isBusy || isReadOnly}
                rows={4}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="customer-notes">Customer notes</Label>
              <textarea
                id="customer-notes"
                value={customerNotes}
                onChange={(event) => setCustomerNotes(event.target.value)}
                disabled={isBusy || isReadOnly}
                rows={4}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="internal-notes">Internal notes</Label>
              <textarea
                id="internal-notes"
                value={internalNotes}
                onChange={(event) => setInternalNotes(event.target.value)}
                disabled={isBusy || isReadOnly}
                rows={4}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
        <CardHeader className="border-b border-neutral-200 pb-4">
          <CardTitle className="text-lg font-semibold text-neutral-950">
            Line items
          </CardTitle>
          <CardDescription>
            Quantities and unit prices exclude VAT.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pt-4">
          {lineItems.map((item, index) => {
            const quantity = Number.parseFloat(item.quantity) || 0;
            const unitPrice = Number.parseFloat(item.unitPrice) || 0;
            const lineTotal = calculateLineTotal(quantity, unitPrice);

            return (
              <QuoteBuilderLineItemCard
                key={item.clientKey}
                item={item}
                index={index}
                totalItems={lineItems.length}
                lineTotal={lineTotal}
                formatGbp={formatGbp}
                isBusy={isBusy}
                isReadOnly={isReadOnly}
                shouldFocusTitle={focusTitleClientKey === item.clientKey}
                onFocusTitle={clearFocusTitle}
                onUpdate={updateLineItem}
                onDuplicate={handleDuplicateLineItem}
                onMoveUp={(clientKey) => handleMoveLineItem(clientKey, -1)}
                onMoveDown={(clientKey) => handleMoveLineItem(clientKey, 1)}
                onDelete={handleRemoveLineItem}
                onSelectImage={handleSelectLineItemImage}
                onRemoveImage={handleRemoveLineItemImage}
                canDelete={lineItems.length > 1}
              />
            );
          })}

          {!isReadOnly && (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={handleAddLineItem}
              className="w-full sm:w-auto"
            >
              Add line item
            </Button>
          )}

          <div className="flex justify-end pt-2">
            <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-500">Subtotal</dt>
                  <dd className="font-medium text-neutral-950">
                    {formatGbp(totals.subtotal)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-500">VAT (20%)</dt>
                  <dd className="font-medium text-neutral-950">
                    {formatGbp(totals.vatAmount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-neutral-200 pt-3">
                  <dt className="font-medium text-neutral-950">
                    Total including VAT
                  </dt>
                  <dd className="text-lg font-semibold text-neutral-950">
                    {formatGbp(totals.total)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Unable to save quote</p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">{success}</p>
        </div>
      )}

      {!isReadOnly && (
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button type="submit" variant="outline" disabled={isBusy}>
            {isSaving ? "Saving..." : "Save draft"}
          </Button>
          {mode === "edit" && (
            <Button type="button" disabled={isBusy} onClick={handleSendQuote}>
              {isSending ? "Sending..." : "Send quote"}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
