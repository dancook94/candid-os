import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  description?: string;
  meta?: string;
  className?: string;
};

export function StatCard({
  label,
  value,
  description,
  meta,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("portal-surface overflow-hidden", className)}>
      <div className="h-0.5 bg-[var(--candid-yellow)]/70" aria-hidden />

      <CardHeader className="pb-0">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          {value}
        </div>

        {description ? (
          <CardDescription className="mt-2 leading-relaxed">
            {description}
          </CardDescription>
        ) : null}

        {meta ? (
          <p className="mt-2 text-sm font-medium text-muted-foreground">{meta}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
