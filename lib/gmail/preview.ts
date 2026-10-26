import { GMAIL_DISCOVERY_FROM, GMAIL_DISCOVERY_TO, GMAIL_ONGOING_SYNC_ENABLED } from "@/lib/gmail/config";
import {
  inclusiveDayCount,
  overlappingDiscoveryRange,
  resolveDiscoveryWindow,
} from "@/lib/gmail/window";

export type DiscoveryPreview = {
  dateFrom: string;
  dateTo: string;
  query: string;
  dayCount: number;
  estimatedMessages: number | null;
  completedWindow: { dateFrom: string; dateTo: string } | null;
  writes: false;
  importsAttachments: false;
  ongoingSyncEnabled: false;
  note: string;
};

export async function previewGmailDiscovery(input?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  preset?: "historical";
  env?: Record<string, string | undefined>;
  listMessages?: (input: {
    query: string;
    pageToken: null;
    maxResults: 1;
  }) => Promise<{ resultSizeEstimate?: number | null }>;
}): Promise<DiscoveryPreview> {
  const window = resolveDiscoveryWindow({
    dateFrom: input?.dateFrom,
    dateTo: input?.dateTo,
    preset: input?.preset,
    env: input?.env,
  });
  const completedWindow = overlappingDiscoveryRange(window, {
    dateFrom: GMAIL_DISCOVERY_FROM,
    dateTo: GMAIL_DISCOVERY_TO,
  });
  let estimatedMessages: number | null = null;

  if (input?.listMessages) {
    const listed = await input.listMessages({
      query: window.query,
      pageToken: null,
      maxResults: 1,
    });
    const estimate = listed.resultSizeEstimate;
    estimatedMessages =
      typeof estimate === "number" && Number.isFinite(estimate) && estimate >= 0
        ? Math.floor(estimate)
        : null;
  }

  const overlapNote = completedWindow
    ? `Attachments already discovered from ${completedWindow.dateFrom} to ${completedWindow.dateTo} are skipped.`
    : "This date range does not overlap the completed 12 July to 12 October discovery.";

  return {
    dateFrom: window.dateFrom,
    dateTo: window.dateTo,
    query: window.query,
    dayCount: inclusiveDayCount(window.dateFrom, window.dateTo),
    estimatedMessages,
    completedWindow,
    writes: false,
    importsAttachments: false,
    ongoingSyncEnabled: GMAIL_ONGOING_SYNC_ENABLED,
    note: `${overlapNote} This preview does not import attachments or write records.`,
  };
}
