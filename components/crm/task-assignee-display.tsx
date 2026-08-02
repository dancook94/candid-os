import { StaffAvatarStack } from "@/components/crm/staff-avatar-stack";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import type { TaskAssigneeProfile } from "@/lib/crm/task-assignees";
import { cn } from "@/lib/utils";

type TaskAssigneeDisplayProps = {
  assignees: TaskAssigneeProfile[];
  maxVisible?: number;
  showNames?: boolean;
  className?: string;
};

export function TaskAssigneeDisplay({
  assignees,
  maxVisible = 3,
  showNames = true,
  className,
}: TaskAssigneeDisplayProps) {
  if (assignees.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const visibleNames = assignees
    .slice(0, maxVisible)
    .map((assignee) => getStaffDisplayName(assignee));
  const remainingCount = assignees.length - visibleNames.length;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <StaffAvatarStack
        members={assignees}
        maxVisible={maxVisible}
        size="sm"
      />
      {showNames ? (
        <span className="min-w-0 text-sm">
          {visibleNames.join(", ")}
          {remainingCount > 0 ? ` +${remainingCount}` : ""}
        </span>
      ) : null}
    </div>
  );
}
