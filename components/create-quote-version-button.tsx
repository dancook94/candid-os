"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type CreateQuoteVersionButtonProps = {
  quoteId: string;
  sourceVersionId: string;
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
  sourceVersionId,
}: CreateQuoteVersionButtonProps) {
  const router = useRouter();
  const supabase = createClient();

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateVersion() {
    const confirmed = window.confirm(
      "Create a new quote version? The current version will be preserved, including its saved costs."
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setIsCreating(true);

    try {
      const { data: newVersionId, error: duplicateError } = await supabase.rpc(
        "duplicate_quote_version",
        { p_source_version_id: sourceVersionId }
      );

      if (duplicateError || !newVersionId) {
        throw duplicateError ?? new Error("Unable to create quote version.");
      }

      const { data: createdVersion, error: versionError } = await supabase
        .from("quote_versions")
        .select("version_number")
        .eq("id", newVersionId)
        .single();

      if (versionError || !createdVersion) {
        throw versionError ?? new Error("Unable to open the new quote version.");
      }

      router.push(`/admin/quotes/${quoteId}?version=${createdVersion.version_number}`);
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
