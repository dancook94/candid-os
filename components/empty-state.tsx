import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("portal-surface border-dashed", className)}>
      <CardContent className="flex flex-col items-center px-4 py-10 text-center sm:px-8 sm:py-12">
        {icon ? (
          <div className="mb-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-border">
            {icon}
          </div>
        ) : null}

        <p className="text-base font-semibold text-foreground">{title}</p>

        {description ? (
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}

        {action ? (
          <div className="mt-5 flex w-full justify-center sm:w-auto">{action}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
