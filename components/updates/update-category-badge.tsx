import { StatusBadge } from "@/components/status-badge";
import {
  formatProductUpdateCategoryLabel,
  type ProductUpdateCategory,
} from "@/lib/updates/types";

type UpdateCategoryBadgeProps = {
  category: ProductUpdateCategory;
};

const categoryVariantMap = {
  new: "sent",
  improvement: "accepted",
  fix: "pending",
} as const;

export function UpdateCategoryBadge({ category }: UpdateCategoryBadgeProps) {
  return (
    <StatusBadge
      status={categoryVariantMap[category]}
      label={formatProductUpdateCategoryLabel(category)}
    />
  );
}
