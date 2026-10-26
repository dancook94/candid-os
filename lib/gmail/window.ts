import {
  GMAIL_DISCOVERY_FROM,
  GMAIL_DISCOVERY_TO,
  GMAIL_HISTORICAL_DISCOVERY_FROM,
  GMAIL_HISTORICAL_DISCOVERY_TO,
} from "@/lib/gmail/config";
import { assertIsoDate, buildGmailDiscoveryQuery } from "@/lib/gmail/query";

export type DiscoveryWindow = {
  dateFrom: string;
  dateTo: string;
  query: string;
};

type DateEnv = Record<string, string | undefined>;

export function resolveDiscoveryWindow(input?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  preset?: "historical";
  env?: DateEnv;
}): DiscoveryWindow {
  const env = input?.env ?? process.env;
  const explicitFrom = input?.dateFrom?.trim() || "";
  const explicitTo = input?.dateTo?.trim() || "";

  if (explicitFrom || explicitTo) {
    return windowFrom(explicitFrom, explicitTo, "Choose both a start date and an end date.");
  }

  if (input?.preset === "historical") {
    return configuredWindow(
      env.GMAIL_HISTORICAL_DISCOVERY_FROM,
      env.GMAIL_HISTORICAL_DISCOVERY_TO,
      GMAIL_HISTORICAL_DISCOVERY_FROM,
      GMAIL_HISTORICAL_DISCOVERY_TO,
      "GMAIL_HISTORICAL_DISCOVERY_FROM and GMAIL_HISTORICAL_DISCOVERY_TO"
    );
  }

  return configuredWindow(
    env.GMAIL_DISCOVERY_FROM,
    env.GMAIL_DISCOVERY_TO,
    GMAIL_DISCOVERY_FROM,
    GMAIL_DISCOVERY_TO,
    "GMAIL_DISCOVERY_FROM and GMAIL_DISCOVERY_TO"
  );
}

export function inclusiveDayCount(dateFrom: string, dateTo: string) {
  const from = assertIsoDate(dateFrom);
  const to = assertIsoDate(dateTo);
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function overlappingDiscoveryRange(
  chosen: { dateFrom: string; dateTo: string },
  existing: { dateFrom: string; dateTo: string }
) {
  const dateFrom = chosen.dateFrom > existing.dateFrom ? chosen.dateFrom : existing.dateFrom;
  const dateTo = chosen.dateTo < existing.dateTo ? chosen.dateTo : existing.dateTo;

  if (dateFrom > dateTo) {
    return null;
  }

  return { dateFrom, dateTo };
}

function configuredWindow(
  configuredFrom: string | undefined,
  configuredTo: string | undefined,
  fallbackFrom: string,
  fallbackTo: string,
  label: string
) {
  const from = configuredFrom?.trim() || "";
  const to = configuredTo?.trim() || "";

  if (from || to) {
    return windowFrom(from, to, `Set both ${label}.`);
  }

  return windowFrom(fallbackFrom, fallbackTo, `Set both ${label}.`);
}

function windowFrom(dateFrom: string, dateTo: string, missingMessage: string): DiscoveryWindow {
  if (!dateFrom || !dateTo) {
    throw new Error(missingMessage);
  }

  const from = assertIsoDate(dateFrom);
  const to = assertIsoDate(dateTo);

  return {
    dateFrom: from,
    dateTo: to,
    query: buildGmailDiscoveryQuery(from, to),
  };
}
