type OutboxOrderingRow = {
  id: string;
  leave_request_id: string | null;
  sickness_id: string | null;
  created_at: string;
};

/**
 * Process rows for the same leave request or sickness record in creation order
 * so delete operations run after superseded upserts.
 */
export function sortCalendarSyncOutboxRows<T extends OutboxOrderingRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftKey = left.leave_request_id ?? left.sickness_id ?? left.id;
    const rightKey = right.leave_request_id ?? right.sickness_id ?? right.id;

    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey);
    }

    return left.created_at.localeCompare(right.created_at);
  });
}
