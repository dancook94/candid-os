import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
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
    <Card
      className={cn(
        "rounded-2xl border-neutral-200 shadow-sm ring-0",
        className
      )}
    >
      <CardContent className="flex flex-col items-center px-6 py-10 text-center">
        {icon && (
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
            {icon}
          </div>
        )}

        <p className="text-sm font-medium text-neutral-950">{title}</p>

        {description && (
          <p className="mt-1 max-w-sm text-sm text-neutral-500">
            {description}
          </p>
        )}

        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
