"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  STAFF_AVATAR_ACCEPT,
  formatStaffAvatarStorageError,
  validateStaffAvatarFile,
  type StaffAvatarMetadata,
} from "@/lib/staff-avatars";

type StaffAvatarFormProps = {
  fullName: string;
  initialAvatar: StaffAvatarMetadata;
  initialPreviewUrl: string | null;
  uploadUrl: string;
  removeUrl: string;
  canEdit?: boolean;
};

export function StaffAvatarForm({
  fullName,
  initialAvatar,
  initialPreviewUrl,
  uploadUrl,
  removeUrl,
  canEdit = true,
}: StaffAvatarFormProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [avatarMetadata, setAvatarMetadata] = useState(initialAvatar);
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

    const validationError = validateStaffAvatarFile(file);

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

    if (!canEdit) {
      return;
    }

    if (!pendingFile) {
      setError("Choose an avatar image to upload.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", pendingFile);

      const response = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        error?: string;
        previewUrl?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to upload avatar.");
        return;
      }

      setPreviewUrl(payload.previewUrl ?? pendingPreviewUrl);
      setAvatarMetadata({
        avatar_storage_path: avatarMetadata.avatar_storage_path,
        avatar_file_name: pendingFile.name,
        avatar_file_type: pendingFile.type,
        avatar_file_size: pendingFile.size,
      });
      clearPendingSelection();
      setSuccess("Avatar uploaded.");
      router.refresh();
    } catch (uploadError) {
      setError(formatStaffAvatarStorageError(uploadError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!canEdit) {
      return;
    }

    setIsSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(removeUrl, {
        method: "DELETE",
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to remove avatar.");
        return;
      }

      setPreviewUrl(null);
      setAvatarMetadata({
        avatar_storage_path: null,
        avatar_file_name: null,
        avatar_file_type: null,
        avatar_file_size: null,
      });
      clearPendingSelection();
      setSuccess("Avatar removed.");
      router.refresh();
    } catch (removeError) {
      setError(formatStaffAvatarStorageError(removeError));
    } finally {
      setIsSubmitting(false);
    }
  }

  const displayPreviewUrl = pendingPreviewUrl ?? previewUrl;
  const hasSavedAvatar = Boolean(avatarMetadata.avatar_storage_path && previewUrl);
  const displayName = pendingFile?.name ?? avatarMetadata.avatar_file_name;

  return (
    <form className="space-y-5" onSubmit={handleUpload}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <StaffAvatarDisplay
          fullName={fullName}
          avatarUrl={displayPreviewUrl}
          size="lg"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="staff-avatar-upload">Profile photo</Label>
          <p className="text-sm text-muted-foreground">
            PNG, JPG, JPEG, or WEBP. Maximum 5 MB.
          </p>

          {canEdit ? (
            <input
              ref={inputRef}
              id="staff-avatar-upload"
              type="file"
              accept={STAFF_AVATAR_ACCEPT}
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
          ) : null}

          {displayName ? (
            <p className="truncate text-xs text-muted-foreground">{displayName}</p>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSubmitting || !pendingFile}>
            {isSubmitting
              ? "Saving..."
              : hasSavedAvatar
                ? "Replace photo"
                : "Upload photo"}
          </Button>

          {hasSavedAvatar ? (
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={handleRemove}
            >
              Remove photo
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
      ) : null}

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
