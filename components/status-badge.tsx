import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
        approved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
        rejected: "bg-red-50 text-red-700 ring-1 ring-red-600/20",
        inactive: "bg-neutral-100 text-neutral-600 ring-1 ring-neutral-500/20",
        default: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-500/20",
      },
    },
    defaultVariants: {
      status: "default",
    },
  }
);

const defaultLabels: Record<
  NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>,
  string
> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  inactive: "Inactive",
  default: "Unknown",
};

type StatusBadgeProps = {
  label?: string;
  className?: string;
} & VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({
  status = "default",
  label,
  className,
}: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ status }), className)}>
      {label ?? defaultLabels[status ?? "default"]}
    </span>
  );
}
