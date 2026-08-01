"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type SourceVersion = {
  id: string;
  version_number: number;
  introduction: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  expiry_date: string | null;
  payment_terms_days: number | null;
  subtotal: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  total: number | null;
};

type SourceItem = {
  title: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  is_optional: boolean;
  line_total: number;
  sort_order: number;
  image_storage_path: string | null;
  image_file_name: string | null;
  image_file_type: string | null;
  image_file_size: number | null;
};

type CreateQuoteVersionButtonProps = {
  quoteId: string;
  sourceVersion: SourceVersion;
  sourceItems: SourceItem[];
};

function formatSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Unable to create quote version.";
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

  return "Unable to create quote version.";
}

export function CreateQuoteVersionButton({
  quoteId,
  sourceVersion,
  sourceItems,
}: CreateQuoteVersionButtonProps) {
  const router = useRouter();
  const supabase = createClient();

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateVersion() {
    const confirmed = window.confirm(
      "Create a new quote version? The current version will be preserved."
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setIsCreating(true);

    try {
      const { data: latestVersion, error: latestVersionError } = await supabase
        .from("quote_versions")
        .select("version_number")
        .eq("quote_id", quoteId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestVersionError) {
        throw latestVersionError;
      }

      if (!latestVersion) {
        throw new Error("Unable to determine latest version.");
      }

      const nextVersionNumber = latestVersion.version_number + 1;

      const { data: createdVersion, error: createVersionError } = await supabase
        .from("quote_versions")
        .insert({
          quote_id: quoteId,
          version_number: nextVersionNumber,
          version_status: "draft",
          introduction: sourceVersion.introduction,
          customer_notes: sourceVersion.customer_notes,
          internal_notes: sourceVersion.internal_notes,
          expiry_date: sourceVersion.expiry_date,
          payment_terms_days: sourceVersion.payment_terms_days,
          subtotal: sourceVersion.subtotal,
          vat_rate: sourceVersion.vat_rate,
          vat_amount: sourceVersion.vat_amount,
          total: sourceVersion.total,
        })
        .select("id, version_number")
        .single();

      if (createVersionError) {
        throw createVersionError;
      }

      if (!createdVersion) {
        throw new Error("Unable to create quote version.");
      }

      if (sourceItems.length > 0) {
        const { error: copyItemsError } = await supabase.from("quote_items").insert(
          sourceItems.map((item) => ({
            quote_version_id: createdVersion.id,
            title: item.title,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            is_optional: item.is_optional,
            line_total: item.line_total,
            sort_order: item.sort_order,
            image_storage_path: item.image_storage_path,
            image_file_name: item.image_file_name,
            image_file_type: item.image_file_type,
            image_file_size: item.image_file_size,
          }))
        );

        if (copyItemsError) {
          await supabase
            .from("quote_versions")
            .delete()
            .eq("id", createdVersion.id);
          throw copyItemsError;
        }
      }

      const { error: quoteUpdateError } = await supabase
        .from("quotes")
        .update({
          current_version: nextVersionNumber,
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", quoteId);

      if (quoteUpdateError) {
        await supabase
          .from("quote_items")
          .delete()
          .eq("quote_version_id", createdVersion.id);
        await supabase.from("quote_versions").delete().eq("id", createdVersion.id);
        throw quoteUpdateError;
      }

      router.push(`/admin/quotes/${quoteId}?version=${nextVersionNumber}`);
      router.refresh();
    } catch (createError) {
      setError(formatSupabaseError(createError));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={isCreating}
        onClick={handleCreateVersion}
      >
        {isCreating ? "Creating version..." : "Create New Version"}
      </Button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Unable to create version
          </p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
