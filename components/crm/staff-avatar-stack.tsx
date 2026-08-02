import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { cn } from "@/lib/utils";

type StaffAvatarStackMember = {
  id: string;
  full_name: string | null;
  avatarUrl?: string | null;
};

type StaffAvatarStackProps = {
  members: StaffAvatarStackMember[];
  maxVisible?: number;
  size?: "sm" | "md";
  className?: string;
};

export function StaffAvatarStack({
  members,
  maxVisible = 3,
  size = "sm",
  className,
}: StaffAvatarStackProps) {
  if (members.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const visibleMembers = members.slice(0, maxVisible);
  const remainingCount = members.length - visibleMembers.length;

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-2">
        {visibleMembers.map((member) => (
          <StaffAvatarDisplay
            key={member.id}
            fullName={getStaffDisplayName(member)}
            avatarUrl={member.avatarUrl}
            size={size}
            className="ring-2 ring-card"
          />
        ))}
      </div>
      {remainingCount > 0 ? (
        <span className="ml-2 text-xs text-muted-foreground">
          +{remainingCount}
        </span>
      ) : null}
    </div>
  );
}
