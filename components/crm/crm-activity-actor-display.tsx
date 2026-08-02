import { Server } from "lucide-react";

import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { cn } from "@/lib/utils";

type CrmActivityActorDisplayProps = {
  actorProfileId?: string | null;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
  showSystemLabel?: boolean;
};

export function CrmActivityActorDisplay({
  actorProfileId,
  actorName,
  actorAvatarUrl,
  size = "sm",
  className,
  showSystemLabel = false,
}: CrmActivityActorDisplayProps) {
  if (!actorProfileId && actorName === "System") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-muted-foreground",
          className
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full border border-border bg-muted",
            size === "sm" ? "h-9 w-9" : "h-11 w-11"
          )}
        >
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
        {showSystemLabel ? <span className="text-sm">System</span> : null}
      </span>
    );
  }

  if (!actorName) {
    return null;
  }

  return (
    <StaffAvatarDisplay
      fullName={actorName}
      avatarUrl={actorAvatarUrl}
      size={size}
      className={className}
    />
  );
}
