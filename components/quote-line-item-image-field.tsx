"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  QUOTE_ITEM_IMAGE_ACCEPT,
  validateQuoteItemImageFile,
} from "@/lib/quote-item-images";

type QuoteLineItemImageFieldProps = {
  clientKey: string;
  fileName: string | null;
  previewUrl: string | null;
  disabled: boolean;
  onSelectFile: (clientKey: string, file: File) => void;
  onRemoveImage: (clientKey: string) => void;
};

export function QuoteLineItemImageField({
  clientKey,
  fileName,
  previewUrl,
  disabled,
  onSelectFile,
  onRemoveImage,
}: QuoteLineItemImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const validationError = validateQuoteItemImageFile(file);

    if (validationError) {
      window.alert(validationError);
      event.target.value = "";
      return;
    }

    onSelectFile(clientKey, file);
    event.target.value = "";
  }

  return (
    <div className="min-w-0 w-full space-y-2 overflow-hidden">
      <Label className="text-xs">Product image (optional)</Label>

      <div className="flex flex-col gap-3">
        <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={fileName ? `${fileName} preview` : "Line item image preview"}
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="px-3 text-center text-xs text-neutral-500">
              No image selected
            </p>
          )}
        </div>

        <div className="min-w-0 w-full space-y-2">
          {fileName && (
            <p className="truncate text-xs text-neutral-600">{fileName}</p>
          )}

          {!disabled && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={inputRef}
                id={`image-${clientKey}`}
                type="file"
                accept={QUOTE_ITEM_IMAGE_ACCEPT}
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                {previewUrl ? "Replace image" : "Add image"}
              </Button>
              {previewUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRemoveImage(clientKey)}
                >
                  Remove image
                </Button>
              )}
            </div>
          )}

          <p className="text-xs text-neutral-500">
            JPG, PNG or WEBP up to 10 MB.
          </p>
        </div>
      </div>
    </div>
  );
}
