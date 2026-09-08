"use client";

import { useCallback, useEffect, useState } from "react";
import { X, ZoomIn } from "lucide-react";

import { cn } from "@/lib/utils";

type PrintfactoryThumbnailImageProps = {
  src: string;
  alt: string;
  className?: string;
  frameClassName?: string;
  maxHeightClassName?: string;
  previewWidthClassName?: string;
  unavailableLabel?: string;
  showUnavailableFallback?: boolean;
  enlargeable?: boolean;
  showEnlargeHint?: boolean;
};

function PrintfactoryThumbnailLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Enlarged preview: ${alt}`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close preview"
          autoFocus
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex max-h-[85vh] max-w-[90vw] items-center justify-center overflow-hidden rounded-xl border border-border bg-neutral-100 p-2 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[calc(85vh-1rem)] max-w-[calc(90vw-2rem)] object-contain"
          />
        </div>
        <p className="max-w-[90vw] truncate text-center text-sm text-white/90">{alt}</p>
      </div>
    </div>
  );
}

export function PrintfactoryThumbnailImage({
  src,
  alt,
  className,
  frameClassName,
  maxHeightClassName = "max-h-32",
  previewWidthClassName,
  unavailableLabel = "Preview unavailable",
  showUnavailableFallback = false,
  enlargeable = false,
  showEnlargeHint = false,
}: PrintfactoryThumbnailImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "hidden">("loading");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  if (state === "hidden") {
    if (!showUnavailableFallback) {
      return null;
    }

    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground",
          previewWidthClassName,
          frameClassName,
          maxHeightClassName
        )}
      >
        {unavailableLabel}
      </div>
    );
  }

  const previewFrame = (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-100",
        previewWidthClassName ?? "w-full max-w-full",
        maxHeightClassName,
        frameClassName
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          "block max-h-full max-w-full object-contain",
          state === "loading" ? "opacity-0" : "opacity-100",
          className
        )}
        onLoad={() => setState("loaded")}
        onError={() => setState("hidden")}
      />
      {enlargeable && state === "loaded" ? (
        <span
          className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/45 p-1 text-white"
          aria-hidden
        >
          <ZoomIn className="h-3 w-3" />
        </span>
      ) : null}
    </div>
  );

  const interactivePreview =
    enlargeable && state === "loaded" ? (
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className={cn(
          "block shrink-0 cursor-zoom-in rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          previewWidthClassName ?? "w-full max-w-full"
        )}
        aria-label={`Enlarge preview: ${alt}`}
      >
        {previewFrame}
      </button>
    ) : (
      previewFrame
    );

  return (
    <>
      <div className="flex w-full max-w-full flex-col items-center gap-1">
        {interactivePreview}
        {enlargeable && showEnlargeHint && state === "loaded" ? (
          <p className="text-[11px] text-muted-foreground">Click to enlarge</p>
        ) : null}
      </div>
      {lightboxOpen ? (
        <PrintfactoryThumbnailLightbox src={src} alt={alt} onClose={closeLightbox} />
      ) : null}
    </>
  );
}
