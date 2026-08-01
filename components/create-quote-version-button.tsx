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
};

type CreateQuoteVersionButtonProps = {
  quoteId: string;
  sourceVersion: SourceVersion;
  sourceItems: SourceItem[];
};

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
      `Create version ${sourceVersion.version_number + 1} from version ${sourceVersion.version_number}? The previous version will remain unchanged.`
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

      if (latestVersionError || !latestVersion) {
        throw new Error(
          latestVersionError?.message ?? "Unable to determine latest version."
        );
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

      if (createVersionError || !createdVersion) {
        throw new Error(
          createVersionError?.message ?? "Unable to create quote version."
        );
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
          }))
        );

        if (copyItemsError) {
          await supabase
            .from("quote_versions")
            .delete()
            .eq("id", createdVersion.id);
          throw new Error(copyItemsError.message);
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
        await supabase.from("quote_items").delete().eq("quote_version_id", createdVersion.id);
        await supabase.from("quote_versions").delete().eq("id", createdVersion.id);
        throw new Error(quoteUpdateError.message);
      }

      router.push(`/admin/quotes/${quoteId}?version=${nextVersionNumber}`);
      router.refresh();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create quote version."
      );
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
        {isCreating ? "Creating version..." : "Create new version"}
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
