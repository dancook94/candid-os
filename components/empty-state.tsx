import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardContent className="flex flex-col items-center px-4 py-8 text-center sm:px-6 sm:py-10">
        {icon && (
          <div className="mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
            {icon}
          </div>
        )}

        <p className="text-sm font-medium text-neutral-950">{title}</p>

        {description && (
          <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
        )}

        {action && (
          <div className="mt-4 flex w-full justify-center sm:w-auto">{action}</div>
        )}
      </CardContent>
    </Card>
  );
}
