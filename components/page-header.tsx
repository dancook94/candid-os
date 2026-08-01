import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div>
        {eyebrow && (
          <p className="text-sm font-medium text-neutral-500">{eyebrow}</p>
        )}

        <h1
          className={cn(
            "text-3xl font-semibold tracking-tight text-neutral-950",
            eyebrow && "mt-1"
          )}
        >
          {title}
        </h1>

        {description && (
          <p className="mt-2 text-neutral-600">{description}</p>
        )}
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
