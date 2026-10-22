import { normalizeContactEmail } from "@/lib/crm/contacts";
import type { WebsiteEnquiryNotificationInput } from "@/lib/notifications/website-enquiry-notification";
import { createAdminClient } from "@/lib/supabase/admin";

import { websiteApiSecret, websiteAuthorizationMatches } from "@/lib/integrations/website-api-auth";
import {
  consumeWebsiteRateLimit,
  type WebsiteRateLimitResult,
} from "@/lib/integrations/website-rate-limit";

const MAX_BODY_BYTES = 32 * 1024;

const ALLOWED_FIELDS = [
  "fullName",
  "company",
  "email",
  "phone",
  "projectName",
  "projectDescription",
  "requiredDate",
  "requiredTime",
  "projectLocation",
  "existingJobReference",
  "artworkPending",
  "externalSubmissionId",
] as const;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type WebsiteQuoteRequestInput = {
  submitter_name: string;
  submitter_company_name: string | null;
  submitter_email: string;
  submitter_phone: string | null;
  project_name: string;
  description: string;
  requested_date: string | null;
  requested_time: string | null;
  project_location: string | null;
  existing_job_reference: string | null;
  artwork_pending: boolean;
  external_submission_id: string;
};

type StoredQuoteRequest = WebsiteQuoteRequestInput & {
  id: string;
  created_at: string;
  source: string;
};

type DbError = { code?: string; message?: string } | null;

type DbResult<T> = {
  data: T;
  error: DbError;
};

type ContactMatch = {
  id: string;
  company_id: string | null;
};

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: string | boolean) => QueryBuilder;
  limit: (count: number) => Promise<DbResult<ContactMatch[]>>;
  maybeSingle: () => Promise<DbResult<StoredQuoteRequest | null>>;
  insert: (row: Record<string, unknown>) => {
    select: (columns: string) => {
      single: () => Promise<DbResult<{ id: string; created_at: string } | null>>;
    };
  };
};

export type WebsiteQuoteRequestAdmin = {
  from: (table: string) => QueryBuilder;
};

type FieldFailure = {
  field: string;
  error: string;
};

async function readLimitedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false as const };
  }

  if (!request.body) {
    return { ok: true as const, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    received += value.byteLength;

    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false as const };
    }

    chunks.push(value);
  }

  return { ok: true as const, text: Buffer.concat(chunks).toString("utf8") };
}

function json(body: unknown, status: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "cache-control": "no-store" };

  if (status === 429 && retryAfterSeconds) {
    headers["retry-after"] = String(retryAfterSeconds);
  }

  return Response.json(body, {
    status,
    headers,
  });
}

function rateLimitResponse(result: Exclude<WebsiteRateLimitResult, { status: "allowed" }>) {
  if (result.status === "unavailable") {
    logWebsiteQuoteRequest({ outcome: "unavailable" });
    return json({ error: "Website API is temporarily unavailable." }, 503);
  }

  logWebsiteQuoteRequest({ outcome: "rate_limited" });
  return json({ error: "Too many requests." }, 429, result.retryAfterSeconds);
}

function logWebsiteQuoteRequest(fields: Record<string, string | number | boolean | null>) {
  console.info(JSON.stringify({ event: "website_quote_request", ...fields }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, label: string, max: number): string | FieldFailure {
  if (typeof value !== "string") {
    return { field, error: `${label} is required.` };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return { field, error: `${label} is required.` };
  }

  if (trimmed.length > max || CONTROL_CHARS.test(trimmed)) {
    return { field, error: `${label} is too long.` };
  }

  return trimmed;
}

function optionalText(value: unknown, field: string, label: string, max: number): string | null | FieldFailure {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    return { field, error: `${label} must be text.` };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > max || CONTROL_CHARS.test(trimmed)) {
    return { field, error: `${label} is too long.` };
  }

  return trimmed;
}

function isFieldFailure(value: unknown): value is FieldFailure {
  return isRecord(value) && typeof value.field === "string" && typeof value.error === "string";
}

function calendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

export function validateWebsiteQuoteRequest(payload: unknown):
  | { ok: true; value: WebsiteQuoteRequestInput }
  | { ok: false; field: string; error: string } {
  if (!isRecord(payload)) {
    return { ok: false, field: "body", error: "The request body must be a JSON object." };
  }

  const unexpected = Object.keys(payload).find((key) => !ALLOWED_FIELDS.includes(key as (typeof ALLOWED_FIELDS)[number]));

  if (unexpected) {
    return { ok: false, field: "body", error: "The request contains an unexpected property." };
  }

  const fullName = requiredText(payload.fullName, "fullName", "Full name", 160);
  if (isFieldFailure(fullName)) {
    return { ok: false, ...fullName };
  }

  const company = optionalText(payload.company, "company", "Company", 200);
  if (isFieldFailure(company)) {
    return { ok: false, ...company };
  }

  const emailText = requiredText(payload.email, "email", "Email", 254);
  if (isFieldFailure(emailText)) {
    return { ok: false, ...emailText };
  }

  const email = normalizeContactEmail(emailText);

  if (!email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, field: "email", error: "Email is invalid." };
  }

  const phone = optionalText(payload.phone, "phone", "Phone", 40);
  if (isFieldFailure(phone)) {
    return { ok: false, ...phone };
  }

  const projectName = requiredText(payload.projectName, "projectName", "Project name", 200);
  if (isFieldFailure(projectName)) {
    return { ok: false, ...projectName };
  }

  const description = requiredText(payload.projectDescription, "projectDescription", "Project description", 8000);
  if (isFieldFailure(description)) {
    return { ok: false, ...description };
  }

  let requestedDate: string | null = null;

  if (payload.requiredDate != null && payload.requiredDate !== "") {
    if (typeof payload.requiredDate !== "string") {
      return { ok: false, field: "requiredDate", error: "Required date must be a calendar date in YYYY-MM-DD format." };
    }

    const trimmedDate = payload.requiredDate.trim();

    if (trimmedDate) {
      requestedDate = calendarDate(trimmedDate);

      if (!requestedDate) {
        return {
          ok: false,
          field: "requiredDate",
          error: "Required date must be a calendar date in YYYY-MM-DD format.",
        };
      }
    }
  }

  const requestedTime = optionalText(payload.requiredTime, "requiredTime", "Required time", 40);
  if (isFieldFailure(requestedTime)) {
    return { ok: false, ...requestedTime };
  }

  const projectLocation = optionalText(payload.projectLocation, "projectLocation", "Project location", 300);
  if (isFieldFailure(projectLocation)) {
    return { ok: false, ...projectLocation };
  }

  const existingJobReference = optionalText(
    payload.existingJobReference,
    "existingJobReference",
    "Existing job reference",
    80
  );
  if (isFieldFailure(existingJobReference)) {
    return { ok: false, ...existingJobReference };
  }

  if (payload.artworkPending != null && typeof payload.artworkPending !== "boolean") {
    return { ok: false, field: "artworkPending", error: "Artwork pending must be true or false." };
  }

  const submissionId = requiredText(payload.externalSubmissionId, "externalSubmissionId", "External submission ID", 128);
  if (isFieldFailure(submissionId)) {
    return { ok: false, ...submissionId };
  }

  if (!SUBMISSION_ID_PATTERN.test(submissionId)) {
    return { ok: false, field: "externalSubmissionId", error: "External submission ID is invalid." };
  }

  return {
    ok: true,
    value: {
      submitter_name: fullName,
      submitter_company_name: company,
      submitter_email: email,
      submitter_phone: phone,
      project_name: projectName,
      description,
      requested_date: requestedDate,
      requested_time: requestedTime,
      project_location: projectLocation,
      existing_job_reference: existingJobReference,
      artwork_pending: payload.artworkPending === true,
      external_submission_id: submissionId,
    },
  };
}

function storedText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function storedDate(value: unknown) {
  const text = storedText(value);

  if (!text) {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(text);
  return match?.[1] ?? text;
}

function sameSubmission(stored: StoredQuoteRequest, value: WebsiteQuoteRequestInput) {
  return (
    storedText(stored.submitter_name) === value.submitter_name &&
    storedText(stored.submitter_company_name) === value.submitter_company_name &&
    storedText(stored.submitter_email)?.toLowerCase() === value.submitter_email &&
    storedText(stored.submitter_phone) === value.submitter_phone &&
    storedText(stored.project_name) === value.project_name &&
    storedText(stored.description) === value.description &&
    storedDate(stored.requested_date) === value.requested_date &&
    storedText(stored.requested_time) === value.requested_time &&
    storedText(stored.project_location) === value.project_location &&
    storedText(stored.existing_job_reference) === value.existing_job_reference &&
    Boolean(stored.artwork_pending) === value.artwork_pending &&
    storedText(stored.external_submission_id) === value.external_submission_id
  );
}

function isUniqueViolation(error: DbError) {
  return error?.code === "23505";
}

async function matchActiveContacts(admin: WebsiteQuoteRequestAdmin, email: string) {
  const { data, error } = await admin
    .from("contacts")
    .select("id, company_id")
    .eq("email", email)
    .eq("is_active", true)
    .limit(2);

  if (error) {
    return { ok: false as const };
  }

  const matches = data ?? [];

  if (matches.length !== 1) {
    return {
      ok: true as const,
      match: matches.length === 0 ? "none" : "multiple",
      suggested_contact_id: null,
      suggested_company_id: null,
    };
  }

  return {
    ok: true as const,
    match: "one" as const,
    suggested_contact_id: matches[0].id,
    suggested_company_id: matches[0].company_id,
  };
}

function successBody(row: { id: string; created_at: string }, submissionId: string, duplicate: boolean) {
  return {
    ok: true,
    quoteRequestId: row.id,
    submissionId,
    createdAt: row.created_at,
    duplicate,
  };
}

async function readExistingSubmission(admin: WebsiteQuoteRequestAdmin, submissionId: string) {
  return admin
    .from("quote_requests")
    .select(
      "id, created_at, source, submitter_name, submitter_company_name, submitter_email, submitter_phone, project_name, description, requested_date, requested_time, project_location, existing_job_reference, artwork_pending, external_submission_id"
    )
    .eq("external_submission_id", submissionId)
    .eq("source", "website")
    .maybeSingle();
}

export async function handleWebsiteQuoteRequest(
  request: Request,
  options: {
    createAdmin?: () => WebsiteQuoteRequestAdmin;
    now?: () => number;
    notifyStaff?: (enquiry: WebsiteEnquiryNotificationInput) => Promise<void>;
  } = {}
) {
  const now = options.now ?? Date.now;
  const secret = websiteApiSecret();

  if (!secret) {
    logWebsiteQuoteRequest({ outcome: "unconfigured" });
    return json({ error: "Website API is not configured." }, 503);
  }

  if (!websiteAuthorizationMatches(request.headers.get("authorization"))) {
    const decision = await consumeWebsiteRateLimit({
      kind: "auth_failure",
      request,
      pepper: secret,
      now: now(),
    });

    if (decision.status !== "allowed") {
      return rateLimitResponse(decision);
    }

    logWebsiteQuoteRequest({ outcome: "unauthorized" });
    return json({ error: "Unauthorized." }, 401);
  }

  const enquiryLimit = await consumeWebsiteRateLimit({
    kind: "enquiry",
    request,
    pepper: secret,
    now: now(),
  });

  if (enquiryLimit.status !== "allowed") {
    return rateLimitResponse(enquiryLimit);
  }

  const bodyText = await readLimitedBody(request);

  if (!bodyText.ok) {
    logWebsiteQuoteRequest({ outcome: "invalid_body", field: "body" });
    return json({ error: "Request body is too large." }, 413);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(bodyText.text);
  } catch {
    logWebsiteQuoteRequest({ outcome: "invalid_body", field: "body" });
    return json({ error: "The request body must be a JSON object." }, 400);
  }

  const validated = validateWebsiteQuoteRequest(payload);

  if (!validated.ok) {
    logWebsiteQuoteRequest({ outcome: "invalid_field", field: validated.field });
    return json({ error: validated.error }, 400);
  }

  const value = validated.value;
  let admin: WebsiteQuoteRequestAdmin;

  try {
    admin = (options.createAdmin ?? (() => createAdminClient() as unknown as WebsiteQuoteRequestAdmin))();
  } catch {
    logWebsiteQuoteRequest({ outcome: "save_failed", submissionId: value.external_submission_id });
    return json({ error: "The enquiry could not be saved." }, 500);
  }

  const suggestion = await matchActiveContacts(admin, value.submitter_email);

  if (!suggestion.ok) {
    logWebsiteQuoteRequest({ outcome: "save_failed", submissionId: value.external_submission_id });
    return json({ error: "The enquiry could not be saved." }, 500);
  }

  const insertRow = {
    source: "website",
    request_status: "submitted",
    submitter_name: value.submitter_name,
    submitter_company_name: value.submitter_company_name,
    submitter_email: value.submitter_email,
    submitter_phone: value.submitter_phone,
    project_name: value.project_name,
    description: value.description,
    requested_date: value.requested_date,
    requested_time: value.requested_time,
    project_location: value.project_location,
    existing_job_reference: value.existing_job_reference,
    artwork_pending: value.artwork_pending,
    external_submission_id: value.external_submission_id,
    suggested_contact_id: suggestion.suggested_contact_id,
    suggested_company_id: suggestion.suggested_company_id,
  };

  const inserted = await admin.from("quote_requests").insert(insertRow).select("id, created_at").single();

  if (!inserted.error && inserted.data) {
    logWebsiteQuoteRequest({
      outcome: "created",
      submissionId: value.external_submission_id,
      quoteRequestId: inserted.data.id,
      match: suggestion.match,
    });

    if (options.notifyStaff) {
      try {
        await options.notifyStaff({
          quoteRequestId: inserted.data.id,
          submitterName: value.submitter_name,
          submitterCompanyName: value.submitter_company_name,
          submitterEmail: value.submitter_email,
          submitterPhone: value.submitter_phone,
          projectName: value.project_name,
          description: value.description,
          requestedDate: value.requested_date,
        });
      } catch (error) {
        logWebsiteQuoteRequest({
          outcome: "staff_notification_failed",
          submissionId: value.external_submission_id,
          quoteRequestId: inserted.data.id,
          message: error instanceof Error ? error.message : "notification_failed",
        });
      }
    }

    return json(successBody(inserted.data, value.external_submission_id, false), 201);
  }

  if (!isUniqueViolation(inserted.error)) {
    logWebsiteQuoteRequest({ outcome: "save_failed", submissionId: value.external_submission_id });
    return json({ error: "The enquiry could not be saved." }, 500);
  }

  const existing = await readExistingSubmission(admin, value.external_submission_id);

  if (existing.error || !existing.data || existing.data.source !== "website") {
    logWebsiteQuoteRequest({ outcome: "conflict", submissionId: value.external_submission_id });
    return json({ error: "This submission ID was already used with different details." }, 409);
  }

  if (!sameSubmission(existing.data, value)) {
    logWebsiteQuoteRequest({ outcome: "conflict", submissionId: value.external_submission_id });
    return json({ error: "This submission ID was already used with different details." }, 409);
  }

  logWebsiteQuoteRequest({
    outcome: "duplicate",
    submissionId: value.external_submission_id,
    quoteRequestId: existing.data.id,
  });

  return json(successBody(existing.data, value.external_submission_id, true), 200);
}
