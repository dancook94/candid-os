import { Building2 } from "lucide-react";

import { getCompanyInitials } from "@/lib/company-logos";
import { cn } from "@/lib/utils";

type CompanyLogoDisplayProps = {
  companyName: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: "h-9 w-9 max-h-9 max-w-[4.5rem]",
  md: "h-16 w-16 max-h-16 max-w-[8rem]",
  lg: "h-32 w-32 max-h-40 max-w-[10rem]",
} as const;

export function CompanyLogoDisplay({
  companyName,
  logoUrl,
  size = "md",
  className,
}: CompanyLogoDisplayProps) {
  const initials = getCompanyInitials(companyName);

  if (logoUrl) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background",
          sizeClasses[size],
          className
        )}
      >
        <img
          src={logoUrl}
          alt={`${companyName} logo`}
          className="h-full w-full object-contain p-1.5"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/60 text-muted-foreground",
        sizeClasses[size],
        className
      )}
      aria-label={`${companyName} account`}
    >
      {initials ? (
        <span
          className={cn(
            "font-semibold text-foreground",
            size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-xl"
          )}
        >
          {initials}
        </span>
      ) : (
        <Building2
          className={cn(
            size === "sm" ? "h-4 w-4" : size === "md" ? "h-6 w-6" : "h-10 w-10"
          )}
          aria-hidden
        />
      )}
    </div>
  );
}
