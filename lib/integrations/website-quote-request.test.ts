import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { WEBSITE_API_SECRET_ENV } from "@/lib/integrations/website-api-auth";
import {
  clearWebsiteRateLimits,
  consumeWebsiteRateLimit,
  WEBSITE_AUTH_FAILURE_LIMIT,
  WEBSITE_ENQUIRY_LIMIT,
} from "@/lib/integrations/website-rate-limit";
import {
  handleWebsiteQuoteRequest,
  type WebsiteQuoteRequestAdmin,
} from "@/lib/integrations/website-quote-request";

const SECRET = "test-website-secret";

type Contact = {
  id: string;
  company_id: string | null;
  email: string;
  is_active: boolean;
};

type StoredRow = Record<string, unknown> & {
  id: string;
  created_at: string;
  external_submission_id: string;
};

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: "Ada Lovelace",
    company: "Analytical Engines",
    email: "Ada@Example.com",
    phone: "0121 000 0000",
    projectName: "Reception panels",
    projectDescription: "Two wall panels for the new reception.\nInclude a logo.",
    requiredDate: "2026-11-02",
    requiredTime: "Morning",
    projectLocation: "Birmingham",
    existingJobReference: "J-100",
    artworkPending: true,
    externalSubmissionId: "web-sub-100",
    ...overrides,
  };
}

function requestFor(body: unknown, authorization?: string, ip = "203.0.113.10") {
  return new Request("https://os.candidcreative.uk/api/integrations/website/quote-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
      ...(authorization ? { authorization } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function createMemoryAdmin(options: { contacts?: Contact[]; failInsert?: { code?: string; message: string } | null } = {}) {
  const contacts = options.contacts ?? [];
  const rows: StoredRow[] = [];
  const operations: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T> | T) {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  const admin = {
    from(table: string) {
      operations.push(`from:${table}`);

      if (table !== "contacts" && table !== "quote_requests") {
        throw new Error(`Unexpected table ${table}`);
      }

      if (table === "contacts") {
        const filters: Record<string, unknown> = {};
        const api = {
          select(columns: string) {
            operations.push(`contacts.select:${columns}`);
            return api;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return api;
          },
          limit(count: number) {
            return enqueue(async () => ({
              data: contacts
                .filter(
                  (contact) =>
                    (filters.email === undefined || contact.email === filters.email) &&
                    (filters.is_active === undefined || contact.is_active === filters.is_active)
                )
                .slice(0, count)
                .map((contact) => ({ id: contact.id, company_id: contact.company_id })),
              error: null,
            }));
          },
          insert() {
            throw new Error("Contact insert is not allowed.");
          },
          maybeSingle() {
            throw new Error("Unexpected contact read.");
          },
        };
        return api;
      }

      return {
        insert(payload: Record<string, unknown>) {
          operations.push("quote_requests.insert");
          return {
            select() {
              return {
                single() {
                  return enqueue(async () => {
                    if (options.failInsert) {
                      return { data: null, error: options.failInsert };
                    }

                    const submissionId = String(payload.external_submission_id);

                    if (rows.some((row) => row.external_submission_id === submissionId)) {
                      return {
                        data: null,
                        error: {
                          code: "23505",
                          message: "duplicate key value violates unique constraint quote_requests_external_submission_id_uidx",
                        },
                      };
                    }

                    const row: StoredRow = {
                      ...payload,
                      id: `qr-${rows.length + 1}`,
                      created_at: "2026-10-20T08:00:00.000Z",
                    };
                    rows.push(row);
                    return { data: { id: row.id, created_at: row.created_at }, error: null };
                  });
                },
              };
            },
          };
        },
        select() {
          operations.push("quote_requests.select");
          const filters: Record<string, unknown> = {};
          const api = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return api;
            },
            maybeSingle() {
              return enqueue(async () => {
                const match =
                  rows.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null;
                return { data: match, error: null };
              });
            },
          };
          return api;
        },
      };
    },
    auth: {
      admin: {
        inviteUserByEmail() {
          throw new Error("inviteUserByEmail was called.");
        },
        createUser() {
          throw new Error("createUser was called.");
        },
      },
    },
  };

  return { admin: admin as unknown as WebsiteQuoteRequestAdmin, rows, operations };
}

function withSecret(secret: string | undefined) {
  const previous = process.env[WEBSITE_API_SECRET_ENV];

  if (secret === undefined) {
    delete process.env[WEBSITE_API_SECRET_ENV];
  } else {
    process.env[WEBSITE_API_SECRET_ENV] = secret;
  }

  return () => {
    if (previous === undefined) {
      delete process.env[WEBSITE_API_SECRET_ENV];
    } else {
      process.env[WEBSITE_API_SECRET_ENV] = previous;
    }
  };
}

async function captureLogs(run: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  try {
    await run();
  } finally {
    console.info = original;
  }

  return lines;
}

describe("website quote request API", { concurrency: 1 }, () => {
test("missing website API secret fails closed before any database access", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(undefined);
  let created = false;

  try {
    const response = await handleWebsiteQuoteRequest(requestFor(validBody()), {
      createAdmin() {
        created = true;
        throw new Error("Admin client was created.");
      },
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Website API is not configured." });
    assert.equal(created, false);
  } finally {
    restore();
  }
});

test("an incorrect secret is rejected before the body or database is used", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  let created = false;

  try {
    const response = await handleWebsiteQuoteRequest(requestFor("{", `Bearer wrong-secret`), {
      createAdmin() {
        created = true;
        throw new Error("Admin client was created.");
      },
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized." });
    assert.equal(created, false);
  } finally {
    restore();
  }
});

test("a valid submission stores a website enquiry and does not link a company", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin({
    contacts: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        company_id: "22222222-2222-4222-8222-222222222222",
        email: "ada@example.com",
        is_active: true,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        company_id: "22222222-2222-4222-8222-222222222222",
        email: "ada@example.com",
        is_active: false,
      },
    ],
  });

  try {
    const lines = await captureLogs(async () => {
      const response = await handleWebsiteQuoteRequest(requestFor(validBody(), `Bearer ${SECRET}`), {
        createAdmin: () => memory.admin,
      });
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.deepEqual(body, {
        ok: true,
        quoteRequestId: "qr-1",
        submissionId: "web-sub-100",
        createdAt: "2026-10-20T08:00:00.000Z",
        duplicate: false,
      });
      assert.equal(JSON.stringify(body).includes("11111111"), false);
      assert.equal(JSON.stringify(body).includes("22222222"), false);
    });

    const row = memory.rows[0];
    assert.equal(row.source, "website");
    assert.equal(row.request_status, "submitted");
    assert.equal(row.submitter_email, "ada@example.com");
    assert.equal(row.requested_date, "2026-11-02");
    assert.equal(row.requested_time, "Morning");
    assert.equal(row.artwork_pending, true);
    assert.equal(row.suggested_contact_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(row.suggested_company_id, "22222222-2222-4222-8222-222222222222");
    assert.equal("company_id" in row, false);
    assert.equal("requested_by" in row, false);
    assert.equal("fulfilment_method" in row, false);
    assert.equal(memory.operations.includes("quote_requests.insert"), true);
    assert.equal(memory.operations.some((operation) => operation.startsWith("contacts.select")), true);
    assert.equal(lines.join("\n").includes(SECRET), false);
    assert.equal(lines.join("\n").includes("ada@example.com"), false);
    assert.equal(lines.join("\n").includes("11111111"), false);
    assert.equal(lines.join("\n").includes("\"match\":\"one\""), true);
  } finally {
    restore();
  }
});

test("optional date and time stay empty when the website omits them", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();
  const body = validBody();
  delete body.requiredDate;
  delete body.requiredTime;

  try {
    const response = await handleWebsiteQuoteRequest(requestFor(body, `Bearer ${SECRET}`, "203.0.113.11"), {
      createAdmin: () => memory.admin,
    });

    assert.equal(response.status, 201);
    assert.equal(memory.rows[0].requested_date, null);
    assert.equal(memory.rows[0].requested_time, null);
    assert.equal(memory.rows[0].artwork_pending, true);
  } finally {
    restore();
  }
});

test("an invalid email is rejected", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();

  try {
    const response = await handleWebsiteQuoteRequest(
      requestFor(validBody({ email: "not-an-email" }), `Bearer ${SECRET}`, "203.0.113.12"),
      { createAdmin: () => memory.admin }
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Email is invalid." });
    assert.equal(memory.rows.length, 0);
    assert.equal(memory.operations.length, 0);
  } finally {
    restore();
  }
});

test("missing required fields are rejected", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);

  try {
    for (const field of ["fullName", "email", "projectName", "projectDescription", "externalSubmissionId"]) {
      const memory = createMemoryAdmin();
      const body = validBody();
      delete body[field as keyof typeof body];
      const response = await handleWebsiteQuoteRequest(
        requestFor(body, `Bearer ${SECRET}`, "203.0.113.13"),
        { createAdmin: () => memory.admin }
      );

      assert.equal(response.status, 400, field);
      assert.equal(memory.rows.length, 0);
    }
  } finally {
    restore();
  }
});

test("unexpected properties and malformed payloads are rejected", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();

  try {
    const extra = await handleWebsiteQuoteRequest(
      requestFor(validBody({ companyId: "22222222-2222-4222-8222-222222222222" }), `Bearer ${SECRET}`, "203.0.113.14"),
      { createAdmin: () => memory.admin }
    );
    const malformed = await handleWebsiteQuoteRequest(
      requestFor("{", `Bearer ${SECRET}`, "203.0.113.15"),
      { createAdmin: () => memory.admin }
    );
    const listed = await handleWebsiteQuoteRequest(
      requestFor([validBody()], `Bearer ${SECRET}`, "203.0.113.16"),
      { createAdmin: () => memory.admin }
    );
    const badDate = await handleWebsiteQuoteRequest(
      requestFor(validBody({ requiredDate: "2026-02-31" }), `Bearer ${SECRET}`, "203.0.113.28"),
      { createAdmin: () => memory.admin }
    );

    assert.equal(extra.status, 400);
    assert.equal(malformed.status, 400);
    assert.equal(listed.status, 400);
    assert.equal(badDate.status, 400);
    assert.deepEqual(await badDate.json(), { error: "Required date must be a calendar date in YYYY-MM-DD format." });
    assert.equal(memory.rows.length, 0);
  } finally {
    restore();
  }
});

test("an identical repeat returns the existing enquiry", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();

  try {
    const first = await handleWebsiteQuoteRequest(requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.17"), {
      createAdmin: () => memory.admin,
    });
    const second = await handleWebsiteQuoteRequest(requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.17"), {
      createAdmin: () => memory.admin,
    });
    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(secondBody.duplicate, true);
    assert.equal(secondBody.quoteRequestId, firstBody.quoteRequestId);
    assert.equal(memory.rows.length, 1);
    assert.equal(memory.operations.filter((operation) => operation === "quote_requests.insert").length, 2);
  } finally {
    restore();
  }
});

test("the same submission ID with different details conflicts", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();

  try {
    const first = await handleWebsiteQuoteRequest(requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.18"), {
      createAdmin: () => memory.admin,
    });
    const second = await handleWebsiteQuoteRequest(
      requestFor(validBody({ projectDescription: "A different brief." }), `Bearer ${SECRET}`, "203.0.113.18"),
      { createAdmin: () => memory.admin }
    );

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: "This submission ID was already used with different details." });
    assert.equal(memory.rows.length, 1);
    assert.equal(memory.rows[0].description, "Two wall panels for the new reception.\nInclude a logo.");
  } finally {
    restore();
  }
});

test("concurrent identical submissions create one enquiry", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();

  try {
    const responses = await Promise.all([
      handleWebsiteQuoteRequest(requestFor(validBody({ externalSubmissionId: "web-sub-race" }), `Bearer ${SECRET}`, "203.0.113.19"), {
        createAdmin: () => memory.admin,
      }),
      handleWebsiteQuoteRequest(requestFor(validBody({ externalSubmissionId: "web-sub-race" }), `Bearer ${SECRET}`, "203.0.113.19"), {
        createAdmin: () => memory.admin,
      }),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 201]
    );
    assert.equal(bodies[0].quoteRequestId, bodies[1].quoteRequestId);
    assert.equal(memory.rows.length, 1);
    assert.equal(memory.operations.filter((operation) => operation === "quote_requests.insert").length, 2);
  } finally {
    restore();
  }
});

test("zero, one, and multiple active contact matches follow the suggestion rules", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const contactA = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    company_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "ada@example.com",
    is_active: true,
  };
  const contactB = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    company_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    email: "ada@example.com",
    is_active: true,
  };

  try {
    const none = createMemoryAdmin();
    await handleWebsiteQuoteRequest(requestFor(validBody({ externalSubmissionId: "web-sub-none" }), `Bearer ${SECRET}`, "203.0.113.20"), {
      createAdmin: () => none.admin,
    });
    assert.equal(none.rows[0].suggested_contact_id, null);
    assert.equal(none.rows[0].suggested_company_id, null);
    assert.equal("company_id" in none.rows[0], false);

    const one = createMemoryAdmin({ contacts: [contactA] });
    const oneResponse = await handleWebsiteQuoteRequest(
      requestFor(validBody({ externalSubmissionId: "web-sub-one" }), `Bearer ${SECRET}`, "203.0.113.21"),
      { createAdmin: () => one.admin }
    );
    const oneBody = await oneResponse.json();
    assert.equal(one.rows[0].suggested_contact_id, contactA.id);
    assert.equal(one.rows[0].suggested_company_id, contactA.company_id);
    assert.equal("company_id" in one.rows[0], false);
    assert.equal(JSON.stringify(oneBody).includes(contactA.id), false);
    assert.equal(JSON.stringify(oneBody).includes(String(contactA.company_id)), false);

    const many = createMemoryAdmin({ contacts: [contactA, contactB] });
    await handleWebsiteQuoteRequest(requestFor(validBody({ externalSubmissionId: "web-sub-many" }), `Bearer ${SECRET}`, "203.0.113.22"), {
      createAdmin: () => many.admin,
    });
    assert.equal(many.rows[0].suggested_contact_id, null);
    assert.equal(many.rows[0].suggested_company_id, null);
    assert.equal("company_id" in many.rows[0], false);
  } finally {
    restore();
  }
});

test("a database insert failure returns a generic error", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin({ failInsert: { code: "XX000", message: "relation quote_requests is unavailable" } });

  try {
    const response = await handleWebsiteQuoteRequest(requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.23"), {
      createAdmin: () => memory.admin,
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: "The enquiry could not be saved." });
    assert.equal(JSON.stringify(body).includes("quote_requests"), false);
    assert.equal(memory.rows.length, 0);
  } finally {
    restore();
  }
});

test("the handler does not create companies, contacts, profiles, or auth users", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const memory = createMemoryAdmin();
  const handlerSource = await readFile(new URL("./website-quote-request.ts", import.meta.url), "utf8");
  const routeSource = await readFile(
    new URL("../../app/api/integrations/website/quote-requests/route.ts", import.meta.url),
    "utf8"
  );

  try {
    const response = await handleWebsiteQuoteRequest(requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.24"), {
      createAdmin: () => memory.admin,
    });

    assert.equal(response.status, 201);
    assert.deepEqual(
      memory.operations.filter((operation) => operation.startsWith("from:")),
      ["from:contacts", "from:quote_requests"]
    );
    assert.equal(handlerSource.includes("inviteUserByEmail"), false);
    assert.equal(handlerSource.includes(".signUp("), false);
    assert.equal(handlerSource.includes("createAdminClient"), true);
    assert.equal(routeSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
    assert.equal(routeSource.includes(SECRET), false);
  } finally {
    restore();
  }
});

test("failed authentication and submissions are rate limited", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);

  try {
    for (let attempt = 0; attempt < WEBSITE_AUTH_FAILURE_LIMIT; attempt += 1) {
      const response = await handleWebsiteQuoteRequest(
        requestFor(validBody(), "Bearer wrong-secret", "203.0.113.25"),
        { createAdmin: () => { throw new Error("Admin client was created."); } }
      );
      assert.equal(response.status, 401);
    }

    const blocked = await handleWebsiteQuoteRequest(
      requestFor(validBody(), "Bearer wrong-secret", "203.0.113.25"),
      { createAdmin: () => { throw new Error("Admin client was created."); } }
    );
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);

    for (let attempt = 0; attempt < WEBSITE_ENQUIRY_LIMIT; attempt += 1) {
      const decision = await consumeWebsiteRateLimit({
        kind: "enquiry",
        request: requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.26"),
        pepper: SECRET,
      });
      assert.equal(decision.status, "allowed");
    }

    const limited = await handleWebsiteQuoteRequest(
      requestFor(validBody(), `Bearer ${SECRET}`, "203.0.113.26"),
      { createAdmin: () => { throw new Error("Admin client was created."); } }
    );
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "Too many requests." });
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  } finally {
    restore();
    clearWebsiteRateLimits();
  }
});

test("an oversized body is rejected before the database is used", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  let created = false;

  try {
    const response = await handleWebsiteQuoteRequest(
      new Request("https://os.candidcreative.uk/api/integrations/website/quote-requests", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-length": "40000",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.27",
        },
        body: JSON.stringify(validBody()),
      }),
      {
        createAdmin() {
          created = true;
          throw new Error("Admin client was created.");
        },
      }
    );

    assert.equal(response.status, 413);
    assert.equal(created, false);
  } finally {
    restore();
  }
});

test("a new website enquiry notifies staff once and a duplicate retry does not", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const { admin, rows } = createMemoryAdmin();
  const notifications: Array<Record<string, unknown>> = [];

  try {
    const first = await handleWebsiteQuoteRequest(
      requestFor(validBody({ externalSubmissionId: "web-notify-1" }), `Bearer ${SECRET}`, "203.0.113.61"),
      {
        createAdmin: () => admin,
        notifyStaff: async (enquiry) => {
          notifications.push(enquiry);
        },
      }
    );
    const second = await handleWebsiteQuoteRequest(
      requestFor(validBody({ externalSubmissionId: "web-notify-1" }), `Bearer ${SECRET}`, "203.0.113.61"),
      {
        createAdmin: () => admin,
        notifyStaff: async (enquiry) => {
          notifications.push(enquiry);
        },
      }
    );

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).duplicate, true);
    assert.equal(rows.length, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].submitterName, "Ada Lovelace");
    assert.equal(notifications[0].submitterEmail, "ada@example.com");
    assert.doesNotMatch(JSON.stringify(notifications[0]), /dropbox|grant|token|secret/i);
  } finally {
    restore();
    clearWebsiteRateLimits();
  }
});

test("a staff notification failure keeps the saved enquiry and does not create a portal account", async () => {
  clearWebsiteRateLimits();
  const restore = withSecret(SECRET);
  const { admin, rows, operations } = createMemoryAdmin();

  try {
    const response = await handleWebsiteQuoteRequest(
      requestFor(validBody({ externalSubmissionId: "web-notify-2" }), `Bearer ${SECRET}`, "203.0.113.62"),
      {
        createAdmin: () => admin,
        notifyStaff: async () => {
          throw new Error("provider rejected the staff email");
        },
      }
    );

    assert.equal(response.status, 201);
    assert.equal(rows.length, 1);
    assert.equal(operations.filter((operation) => operation === "quote_requests.insert").length, 1);
    assert.doesNotMatch(operations.join("\n"), /auth|profiles|createUser/);
  } finally {
    restore();
    clearWebsiteRateLimits();
  }
});
});
