import { createHmac } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const WEBSITE_RATE_WINDOW_MS = 10 * 60 * 1000;
export const WEBSITE_AUTH_FAILURE_LIMIT = 20;
export const WEBSITE_AUTH_FAILURE_GLOBAL_LIMIT = 200;
export const WEBSITE_ENQUIRY_LIMIT = 30;
/** @deprecated Use WEBSITE_ENQUIRY_LIMIT. Kept so older tests name the same quota. */
export const WEBSITE_SUBMISSION_LIMIT = WEBSITE_ENQUIRY_LIMIT;
export const WEBSITE_ARTWORK_OPEN_LIMIT = 60;
export const WEBSITE_ARTWORK_OPEN_ENQUIRY_LIMIT = 15;
export const WEBSITE_ARTWORK_RENEW_LIMIT = 60;
export const WEBSITE_ARTWORK_RENEW_FILE_LIMIT = 20;
// One 500 MB file is 125 chunks of 4 MB. Ten files are about 1,250 chunks.
// The file cap leaves room for several retries. The IP cap still fits ten files.
export const WEBSITE_ARTWORK_CHUNK_IP_LIMIT = 2000;
export const WEBSITE_ARTWORK_CHUNK_FILE_LIMIT = 600;
export const WEBSITE_ARTWORK_COMPLETE_IP_LIMIT = 60;
export const WEBSITE_ARTWORK_COMPLETE_FILE_LIMIT = 12;

export const UPSTASH_REDIS_REST_URL_ENV = "UPSTASH_REDIS_REST_URL";
export const UPSTASH_REDIS_REST_TOKEN_ENV = "UPSTASH_REDIS_REST_TOKEN";
export const WEBSITE_RATE_LIMIT_MODE_ENV = "CANDID_OS_WEBSITE_RATE_LIMIT";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WebsiteRateLimitKind =
  | "auth_failure"
  | "enquiry"
  | "artwork_open"
  | "artwork_renew"
  | "artwork_chunk"
  | "artwork_complete";

export type WebsiteRateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

type HitResult = { allowed: boolean; retryAfterSeconds: number };

export type WebsiteRateLimitStore = {
  hit(prefix: string, identifier: string, limit: number, now: number): Promise<HitResult>;
};

type ScopeRule = {
  prefix:
    | "candid-os:website:auth-failure"
    | "candid-os:website:enquiry"
    | "candid-os:website:artwork-open"
    | "candid-os:website:artwork-renew"
    | "candid-os:website:artwork-chunk"
    | "candid-os:website:artwork-complete";
  identifier: string;
  limit: number;
};

const memoryBuckets = new Map<string, number[]>();
let memoryOperations = 0;
let testStore: WebsiteRateLimitStore | null = null;
const redisLimiters = new Map<string, Ratelimit>();
let cachedUpstash: WebsiteRateLimitStore | null = null;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function memoryModeRequested() {
  return process.env[WEBSITE_RATE_LIMIT_MODE_ENV] === "memory";
}

function automatedTestRun() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

export function clearWebsiteRateLimits() {
  memoryBuckets.clear();
  memoryOperations = 0;
  testStore = null;
  cachedUpstash = null;
  redisLimiters.clear();
}

export function websiteRateLimitOperations() {
  return memoryOperations;
}

export function websiteRateLimitKeysForTests() {
  if (isProduction()) {
    return [];
  }

  return [...memoryBuckets.keys()];
}

export function useWebsiteRateLimitStoreForTests(store: WebsiteRateLimitStore | null) {
  if (isProduction()) {
    throw new Error("Website rate-limit mocks are refused in production.");
  }

  testStore = store;
}

/**
 * Vercel overwrites `x-vercel-forwarded-for` and `x-real-ip`.
 * `x-forwarded-for` is ignored because a caller can prepend a spoofed address.
 * When neither platform header is present, every request shares one identity
 * so omitting the headers cannot mint a fresh quota.
 */
export function trustedWebsiteClientIp(request: Request) {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "";

  if (isIp(vercelForwarded)) {
    return vercelForwarded;
  }

  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";

  if (isIp(realIp)) {
    return realIp;
  }

  return "unknown";
}

function isIp(value: string) {
  if (!value || value.length > 64 || /[\s/]/.test(value)) {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }

  return /^[0-9a-f:]+$/i.test(value) && value.includes(":");
}

function hashedIdentity(pepper: string, ip: string) {
  return createHmac("sha256", pepper).update(ip).digest("hex").slice(0, 32);
}

function scopeId(value: string | undefined) {
  if (!value || !UUID_PATTERN.test(value)) {
    return null;
  }

  return value.toLowerCase();
}

function rulesFor(
  kind: WebsiteRateLimitKind,
  identity: string,
  scope: string | undefined
): ScopeRule[] | null {
  if (kind === "auth_failure") {
    return [
      {
        prefix: "candid-os:website:auth-failure",
        identifier: identity,
        limit: WEBSITE_AUTH_FAILURE_LIMIT,
      },
      {
        prefix: "candid-os:website:auth-failure",
        identifier: "global",
        limit: WEBSITE_AUTH_FAILURE_GLOBAL_LIMIT,
      },
    ];
  }

  if (kind === "enquiry") {
    return [
      {
        prefix: "candid-os:website:enquiry",
        identifier: identity,
        limit: WEBSITE_ENQUIRY_LIMIT,
      },
    ];
  }

  const id = scopeId(scope);

  if (!id) {
    return null;
  }

  if (kind === "artwork_open") {
    return [
      {
        prefix: "candid-os:website:artwork-open",
        identifier: identity,
        limit: WEBSITE_ARTWORK_OPEN_LIMIT,
      },
      {
        prefix: "candid-os:website:artwork-open",
        identifier: `enquiry:${id}`,
        limit: WEBSITE_ARTWORK_OPEN_ENQUIRY_LIMIT,
      },
    ];
  }

  if (kind === "artwork_renew") {
    return [
      {
        prefix: "candid-os:website:artwork-renew",
        identifier: identity,
        limit: WEBSITE_ARTWORK_RENEW_LIMIT,
      },
      {
        prefix: "candid-os:website:artwork-renew",
        identifier: `file:${id}`,
        limit: WEBSITE_ARTWORK_RENEW_FILE_LIMIT,
      },
    ];
  }

  if (kind === "artwork_chunk") {
    return [
      {
        prefix: "candid-os:website:artwork-chunk",
        identifier: identity,
        limit: WEBSITE_ARTWORK_CHUNK_IP_LIMIT,
      },
      {
        prefix: "candid-os:website:artwork-chunk",
        identifier: `file:${id}`,
        limit: WEBSITE_ARTWORK_CHUNK_FILE_LIMIT,
      },
    ];
  }

  return [
    {
      prefix: "candid-os:website:artwork-complete",
      identifier: identity,
      limit: WEBSITE_ARTWORK_COMPLETE_IP_LIMIT,
    },
    {
      prefix: "candid-os:website:artwork-complete",
      identifier: `file:${id}`,
      limit: WEBSITE_ARTWORK_COMPLETE_FILE_LIMIT,
    },
  ];
}

function prune(times: number[], now: number) {
  const cutoff = now - WEBSITE_RATE_WINDOW_MS;
  return times.filter((timestamp) => timestamp > cutoff);
}

const memoryStore: WebsiteRateLimitStore = {
  async hit(prefix, identifier, limit, now) {
    memoryOperations += 1;
    const key = `${prefix}:${identifier}`;
    const current = prune(memoryBuckets.get(key) ?? [], now);

    if (current.length >= limit) {
      memoryBuckets.set(key, current);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current[0] + WEBSITE_RATE_WINDOW_MS - now) / 1000)),
      };
    }

    current.push(now);
    memoryBuckets.set(key, current);
    return { allowed: true, retryAfterSeconds: 0 };
  },
};

function redisConfig() {
  const url = process.env[UPSTASH_REDIS_REST_URL_ENV]?.trim() ?? "";
  const token = process.env[UPSTASH_REDIS_REST_TOKEN_ENV]?.trim() ?? "";

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

function upstashStore(): WebsiteRateLimitStore {
  if (cachedUpstash) {
    return cachedUpstash;
  }

  const config = redisConfig();

  if (!config) {
    return {
      async hit() {
        return { allowed: false, retryAfterSeconds: 0 };
      },
    };
  }

  const redis = new Redis({ url: config.url, token: config.token });
  const store: WebsiteRateLimitStore = {
    async hit(prefix, identifier, limit) {
      const cacheKey = `${prefix}:${limit}`;
      let limiter = redisLimiters.get(cacheKey);

      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(limit, "10 m"),
          prefix,
          analytics: false,
          ephemeralCache: false,
        });
        redisLimiters.set(cacheKey, limiter);
      }

      const result = await limiter.limit(identifier);
      const resetAt = Number.isFinite(result.reset) ? result.reset : Date.now() + WEBSITE_RATE_WINDOW_MS;

      return {
        allowed: result.success,
        retryAfterSeconds: result.success
          ? 0
          : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
      };
    },
  };

  cachedUpstash = store;
  return store;
}

function selectStore(): WebsiteRateLimitStore | "unavailable" {
  if (isProduction()) {
    return redisConfig() ? upstashStore() : "unavailable";
  }

  if (testStore) {
    return testStore;
  }

  if (memoryModeRequested() || automatedTestRun()) {
    return memoryStore;
  }

  if (redisConfig()) {
    return upstashStore();
  }

  return "unavailable";
}

function limited(results: HitResult[]): WebsiteRateLimitResult {
  const blocked = results.filter((result) => !result.allowed);

  if (blocked.length === 0) {
    return { status: "allowed" };
  }

  return {
    status: "limited",
    retryAfterSeconds: Math.max(...blocked.map((result) => result.retryAfterSeconds)),
  };
}

export async function consumeWebsiteRateLimit(input: {
  kind: WebsiteRateLimitKind;
  request: Request;
  pepper: string;
  scopeId?: string;
  now?: number;
}): Promise<WebsiteRateLimitResult> {
  const pepper = input.pepper.trim();

  if (!pepper) {
    return { status: "unavailable" };
  }

  const rules = rulesFor(
    input.kind,
    hashedIdentity(pepper, trustedWebsiteClientIp(input.request)),
    input.scopeId
  );

  if (!rules) {
    return { status: "unavailable" };
  }

  const store = selectStore();

  if (store === "unavailable") {
    return { status: "unavailable" };
  }

  const now = input.now ?? Date.now();

  try {
    const results: HitResult[] = [];

    for (const rule of rules) {
      const result = await store.hit(rule.prefix, rule.identifier, rule.limit, now);

      if (!result.allowed && result.retryAfterSeconds <= 0) {
        return { status: "unavailable" };
      }

      results.push(result);

      if (!result.allowed) {
        break;
      }
    }

    return limited(results);
  } catch {
    return { status: "unavailable" };
  }
}
