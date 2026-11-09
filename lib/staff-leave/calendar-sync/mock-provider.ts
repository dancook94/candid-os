import type { StaffLeaveCalendarEventPayload } from "@/lib/staff-leave/calendar-sync/build-event";
import type {
  CalendarSyncProvider,
  CalendarSyncUpsertResult,
} from "@/lib/staff-leave/calendar-sync/provider-types";

type MockEventRecord = {
  calendarId: string;
  event: StaffLeaveCalendarEventPayload;
  etag: string;
};

const mockStore = new Map<string, MockEventRecord>();

function storeKey(calendarId: string, eventId: string) {
  return `${calendarId}::${eventId}`;
}

export function resetMockCalendarStore() {
  mockStore.clear();
}

export function getMockCalendarStoreSize() {
  return mockStore.size;
}

export function getMockCalendarEvent(calendarId: string, eventId: string) {
  return mockStore.get(storeKey(calendarId, eventId))?.event ?? null;
}

export function createMockCalendarSyncProvider(): CalendarSyncProvider {
  return {
    async upsertEvent(calendarId, event): Promise<CalendarSyncUpsertResult> {
      const etag = `mock-etag-${event.fingerprint.slice(0, 16)}`;
      mockStore.set(storeKey(calendarId, event.eventId), {
        calendarId,
        event,
        etag,
      });

      return {
        provider: "mock",
        googleCalendarId: calendarId,
        googleEventId: event.eventId,
        etag,
        deliveredToGoogle: false,
      };
    },

    async deleteEvent(calendarId, eventId) {
      mockStore.delete(storeKey(calendarId, eventId));
      return { deliveredToGoogle: false };
    },
  };
}
