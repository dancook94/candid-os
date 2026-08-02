import { getStaffInitials } from "@/lib/staff-avatars";
import { cn } from "@/lib/utils";

type StaffAvatarDisplayProps = {
  fullName: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-24 w-24",
} as const;

export function StaffAvatarDisplay({
  fullName,
  avatarUrl,
  size = "md",
  className,
}: StaffAvatarDisplayProps) {
  const initials = getStaffInitials(fullName);

  if (avatarUrl) {
    return (
      <div
        className={cn(
          "shrink-0 overflow-hidden rounded-full border border-border bg-muted",
          sizeClasses[size],
          className
        )}
      >
        <img
          src={avatarUrl}
          alt={`${fullName} avatar`}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground",
        sizeClasses[size],
        className
      )}
      aria-label={`${fullName} profile`}
    >
      <span
        className={cn(
          "font-semibold text-foreground",
          size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-xl"
        )}
      >
        {initials}
      </span>
    </div>
  );
}
