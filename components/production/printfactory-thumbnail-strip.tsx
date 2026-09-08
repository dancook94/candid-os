"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

import {
  PrintfactoryThumbnailImage,
} from "@/components/production/printfactory-thumbnail";
import { PRINTFACTORY_THUMBNAIL_INLINE_MAX } from "@/lib/printfactory/output-page-count";
import { buildPrintfactoryThumbnailProxyPath } from "@/lib/printfactory/thumbnail";
import { cn } from "@/lib/utils";

type PrintfactoryThumbnailStripProps = {
  jobGuid: string;
  outputPageCount: number;
  alt: string;
  inlineMax?: number;
  previewWidthClassName?: string;
  maxHeightClassName?: string;
  showSheetCountLabel?: boolean;
  showEnlargeHint?: boolean;
  className?: string;
};

function PrintfactoryThumbnailCarousel({
  jobGuid,
  alt,
  outputPageCount,
  initialPage,
  onClose,
}: {
  jobGuid: string;
  alt: string;
  outputPageCount: number;
  initialPage: number;
  onClose: () => void;
}) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const src = buildPrintfactoryThumbnailProxyPath(jobGuid, currentPage);

  const goPrevious = useCallback(() => {
    setCurrentPage((page) => Math.max(1, page - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentPage((page) => Math.min(outputPageCount, page + 1));
  }, [outputPageCount]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }

      if (event.key === "ArrowLeft") {
        goPrevious();
      }

      if (event.key === "ArrowRight") {
        goNext();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [goNext, goPrevious, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`PrintFactory sheet preview: ${alt}`}
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

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goPrevious}
            disabled={currentPage <= 1}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous sheet"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>

          <div className="flex max-h-[85vh] max-w-[calc(90vw-7rem)] items-center justify-center overflow-hidden rounded-xl border border-border bg-neutral-100 p-2 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={src}
              src={src}
              alt={`${alt} — sheet ${currentPage}`}
              className="max-h-[calc(85vh-1rem)] max-w-full object-contain"
            />
          </div>

          <button
            type="button"
            onClick={goNext}
            disabled={currentPage >= outputPageCount}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next sheet"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="text-center text-sm text-white/90">
          Sheet {currentPage} of {outputPageCount}
        </p>
      </div>
    </div>
  );
}

function InlineThumbnailButton({
  jobGuid,
  page,
  alt,
  maxHeightClassName,
  previewWidthClassName,
  onOpen,
}: {
  jobGuid: string;
  page: number;
  alt: string;
  maxHeightClassName?: string;
  previewWidthClassName?: string;
  onOpen: (page: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const src = buildPrintfactoryThumbnailProxyPath(jobGuid, page);

  return (
    <button
      type="button"
      onClick={() => onOpen(page)}
      className={cn(
        "relative shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        previewWidthClassName,
        maxHeightClassName
      )}
      aria-label={`Enlarge sheet ${page}: ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${alt} — sheet ${page}`}
        loading="lazy"
        decoding="async"
        className={cn(
          "block max-h-full max-w-full object-contain",
          loaded ? "opacity-100" : "opacity-0"
        )}
        onLoad={() => setLoaded(true)}
      />
      {loaded ? (
        <span
          className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/45 px-1 py-0.5 text-[10px] font-medium text-white"
          aria-hidden
        >
          {page}
        </span>
      ) : null}
      {loaded ? (
        <span
          className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/45 p-1 text-white"
          aria-hidden
        >
          <ZoomIn className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  );
}

export function PrintfactoryThumbnailStrip({
  jobGuid,
  outputPageCount,
  alt,
  inlineMax = PRINTFACTORY_THUMBNAIL_INLINE_MAX,
  previewWidthClassName = "w-[68px]",
  maxHeightClassName = "h-16 max-h-16",
  showSheetCountLabel = false,
  showEnlargeHint = false,
  className,
}: PrintfactoryThumbnailStripProps) {
  const [carouselPage, setCarouselPage] = useState<number | null>(null);
  const closeCarousel = useCallback(() => setCarouselPage(null), []);

  const inlinePages = useMemo(() => {
    const total = Math.max(1, outputPageCount);
    const visibleCount = Math.min(total, inlineMax);

    return Array.from({ length: visibleCount }, (_, index) => index + 1);
  }, [inlineMax, outputPageCount]);

  const hiddenCount = Math.max(0, outputPageCount - inlinePages.length);

  if (outputPageCount <= 1) {
    return (
      <div className={className}>
        <PrintfactoryThumbnailImage
          src={buildPrintfactoryThumbnailProxyPath(jobGuid)}
          alt={alt}
          previewWidthClassName={previewWidthClassName ?? "w-full max-w-full"}
          maxHeightClassName={maxHeightClassName ?? "max-h-40"}
          enlargeable
          showEnlargeHint={showEnlargeHint}
        />
      </div>
    );
  }

  return (
    <>
      <div className={cn("flex w-full max-w-full flex-col gap-1.5", className)}>
        {showSheetCountLabel ? (
          <p className="text-[11px] font-medium text-muted-foreground">
            {outputPageCount} ripped sheets
          </p>
        ) : null}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {inlinePages.map((page) => (
            <InlineThumbnailButton
              key={page}
              jobGuid={jobGuid}
              page={page}
              alt={alt}
              maxHeightClassName={maxHeightClassName}
              previewWidthClassName={previewWidthClassName}
              onOpen={setCarouselPage}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setCarouselPage(inlinePages[inlinePages.length - 1] + 1)}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-2 text-xs font-medium text-muted-foreground hover:bg-muted/50",
                previewWidthClassName,
                maxHeightClassName
              )}
            >
              +{hiddenCount} more
            </button>
          ) : null}
        </div>
        {showEnlargeHint ? (
          <p className="text-[11px] text-muted-foreground">Click a sheet to enlarge</p>
        ) : null}
      </div>
      {carouselPage != null ? (
        <PrintfactoryThumbnailCarousel
          jobGuid={jobGuid}
          alt={alt}
          outputPageCount={Math.max(1, outputPageCount)}
          initialPage={carouselPage}
          onClose={closeCarousel}
        />
      ) : null}
    </>
  );
}

export { PrintfactoryThumbnailCarousel };
