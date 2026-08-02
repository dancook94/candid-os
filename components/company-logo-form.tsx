"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CompanyLogoDisplay } from "@/components/company-logo-display";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  COMPANY_LOGOS_BUCKET,
  COMPANY_LOGO_ACCEPT,
  deleteCompanyLogoObject,
  emptyCompanyLogoMetadata,
  formatSupabaseStorageError,
  uploadCompanyLogo,
  validateCompanyLogoFile,
  type CompanyLogoMetadata,
} from "@/lib/company-logos";
import { createClient } from "@/lib/supabase/client";

type CompanyLogoFormProps = {
  companyId: string;
  companyName: string;
  initialLogo: CompanyLogoMetadata;
  initialPreviewUrl: string | null;
};

export function CompanyLogoForm({
  companyId,
  companyName,
  initialLogo,
  initialPreviewUrl,
}: CompanyLogoFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [logoMetadata, setLogoMetadata] = useState(initialLogo);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function clearPendingSelection() {
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
    }

    setPendingFile(null);
    setPendingPreviewUrl(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setError("");
    setSuccess("");

    if (!file) {
      return;
    }

    const validationError = validateCompanyLogoFile(file);

    if (validationError) {
      setError(validationError);
      event.target.value = "";
      return;
    }

    clearPendingSelection();
    setPendingFile(file);
    setPendingPreviewUrl(URL.createObjectURL(file));
    event.target.value = "";
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingFile) {
      setError("Choose a logo file to upload.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setSuccess("");

    const previousStoragePath = logoMetadata.logo_storage_path;

    try {
      const metadata = await uploadCompanyLogo(supabase, {
        file: pendingFile,
        companyId,
      });

      const { error: updateError } = await supabase
        .from("companies")
        .update(metadata)
        .eq("id", companyId);

      if (updateError) {
        await deleteCompanyLogoObject(supabase, metadata.logo_storage_path);
        throw updateError;
      }

      if (
        previousStoragePath &&
        previousStoragePath !== metadata.logo_storage_path
      ) {
        try {
          await deleteCompanyLogoObject(supabase, previousStoragePath);
        } catch (cleanupError) {
          console.error("[company-logo] failed to delete replaced logo", cleanupError);
        }
      }

      const { data: signedUrlData, error: signedUrlError } =
        await supabase.storage
          .from(COMPANY_LOGOS_BUCKET)
          .createSignedUrl(metadata.logo_storage_path!, 3600);

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw signedUrlError ?? new Error("Unable to generate logo preview URL.");
      }

      setLogoMetadata(metadata);
      setPreviewUrl(signedUrlData.signedUrl);
      clearPendingSelection();
      setSuccess("Company logo uploaded.");
      router.refresh();
    } catch (uploadError) {
      setError(formatSupabaseStorageError(uploadError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove() {
    setIsSubmitting(true);
    setError("");
    setSuccess("");

    const previousStoragePath = logoMetadata.logo_storage_path;

    try {
      const { error: updateError } = await supabase
        .from("companies")
        .update(emptyCompanyLogoMetadata())
        .eq("id", companyId);

      if (updateError) {
        throw updateError;
      }

      if (previousStoragePath) {
        await deleteCompanyLogoObject(supabase, previousStoragePath);
      }

      setLogoMetadata(emptyCompanyLogoMetadata());
      setPreviewUrl(null);
      clearPendingSelection();
      setSuccess("Company logo removed.");
      router.refresh();
    } catch (removeError) {
      setError(formatSupabaseStorageError(removeError));
    } finally {
      setIsSubmitting(false);
    }
  }

  const displayPreviewUrl = pendingPreviewUrl ?? previewUrl;
  const hasSavedLogo = Boolean(logoMetadata.logo_storage_path && previewUrl);
  const displayName = pendingFile?.name ?? logoMetadata.logo_file_name;

  return (
    <form className="space-y-5" onSubmit={handleUpload}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <CompanyLogoDisplay
          companyName={companyName}
          logoUrl={displayPreviewUrl}
          size="lg"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="company-logo-upload">Company logo</Label>
          <p className="text-sm text-muted-foreground">
            SVG, PNG, JPG, JPEG, or WEBP. Maximum 5 MB.
          </p>

          <input
            ref={inputRef}
            id="company-logo-upload"
            type="file"
            accept={COMPANY_LOGO_ACCEPT}
            onChange={handleFileChange}
            disabled={isSubmitting}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
          />

          {displayName ? (
            <p className="truncate text-xs text-muted-foreground">{displayName}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting || !pendingFile}>
          {isSubmitting ? "Saving..." : hasSavedLogo ? "Replace logo" : "Upload logo"}
        </Button>

        {hasSavedLogo ? (
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={handleRemove}
          >
            Remove logo
          </Button>
        ) : null}

        {pendingFile ? (
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            onClick={clearPendingSelection}
          >
            Clear selection
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}
    </form>
  );
}
