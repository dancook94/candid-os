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
  className?: string;
};

export function StatCard({
  label,
  value,
  description,
  className,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "rounded-2xl border-neutral-200 shadow-sm ring-0",
        className
      )}
    >
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-normal text-neutral-500">
          {label}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-3">
        <p className="text-3xl font-semibold text-neutral-950">{value}</p>

        {description && (
          <CardDescription className="mt-2">{description}</CardDescription>
        )}
      </CardContent>
    </Card>
  );
}
