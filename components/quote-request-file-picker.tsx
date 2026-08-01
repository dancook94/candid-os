"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  formatFileSize,
  QUOTE_REQUEST_FILE_ACCEPT,
  validateQuoteRequestFile,
} from "@/lib/quote-request-attachments";

type QuoteRequestFilePickerProps = {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  error?: string;
  onValidationError?: (message: string) => void;
};

export function QuoteRequestFilePicker({
  files,
  onFilesChange,
  disabled = false,
  error,
  onValidationError,
}: QuoteRequestFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileSelection(selectedFiles: FileList | null) {
    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }

    const nextFiles = [...files];
    const rejectionMessages: string[] = [];

    Array.from(selectedFiles).forEach((file) => {
      const validationError = validateQuoteRequestFile(file);

      if (validationError) {
        rejectionMessages.push(`${file.name}: ${validationError}`);
        return;
      }

      nextFiles.push(file);
    });

    if (rejectionMessages.length > 0) {
      onValidationError?.(rejectionMessages.join(" "));
    }

    onFilesChange(nextFiles);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleRemove(index: number) {
    onFilesChange(files.filter((_, fileIndex) => fileIndex !== index));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Label htmlFor="quoteRequestFiles">Attachments</Label>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Add files
        </Button>
      </div>

      <input
        ref={inputRef}
        id="quoteRequestFiles"
        type="file"
        multiple
        accept={QUOTE_REQUEST_FILE_ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(event) => handleFileSelection(event.target.files)}
      />

      <p className="text-xs text-neutral-500">
        PDF, Excel, Word, ZIP, JPG, PNG, AI, EPS, and SVG files are supported.
        Files upload after the quote request is created.
      </p>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-950">
                  {file.name}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatFileSize(file.size)}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => handleRemove(index)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
