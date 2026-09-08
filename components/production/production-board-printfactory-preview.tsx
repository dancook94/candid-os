"use client";

import { useCallback, useState } from "react";

import { PrintfactoryThumbnailCarousel } from "@/components/production/printfactory-thumbnail-strip";
import { PrintfactoryThumbnailImage } from "@/components/production/printfactory-thumbnail";
import { cn } from "@/lib/utils";

type ProductionBoardPrintfactoryPreviewProps = {
  jobGuid: string | null;
  thumbnailUrl: string;
  alt: string;
  outputPageCount: number;
  maxHeightClassName?: string;
  className?: string;
};

export function ProductionBoardPrintfactoryPreview({
  jobGuid,
  thumbnailUrl,
  alt,
  outputPageCount,
  maxHeightClassName = "max-h-28",
  className,
}: ProductionBoardPrintfactoryPreviewProps) {
  const [carouselOpen, setCarouselOpen] = useState(false);
  const closeCarousel = useCallback(() => setCarouselOpen(false), []);
  const multiSheet = outputPageCount > 1 && Boolean(jobGuid);

  const preview = multiSheet ? (
    <button
      type="button"
      onClick={() => setCarouselOpen(true)}
      className={cn(
        "block w-full cursor-zoom-in rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      aria-label={`Open ${outputPageCount} PrintFactory sheets for ${alt}`}
    >
      <div className="relative">
        <PrintfactoryThumbnailImage
          src={thumbnailUrl}
          alt={alt}
          maxHeightClassName={maxHeightClassName}
        />
        <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {outputPageCount} sheets
        </span>
      </div>
    </button>
  ) : (
    <PrintfactoryThumbnailImage
      src={thumbnailUrl}
      alt={alt}
      maxHeightClassName={maxHeightClassName}
      className={className}
    />
  );

  return (
    <>
      {preview}
      {multiSheet && carouselOpen && jobGuid ? (
        <PrintfactoryThumbnailCarousel
          jobGuid={jobGuid}
          alt={alt}
          outputPageCount={outputPageCount}
          initialPage={1}
          onClose={closeCarousel}
        />
      ) : null}
    </>
  );
}
