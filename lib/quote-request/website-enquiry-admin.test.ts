import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createOpportunityFromQuoteRequest } from "@/lib/crm/opportunity-linking";
import {
  buildQuoteRequestInboxRow,
  websiteEnquiryDetailItems,
  websiteSuggestionSummary,
} from "@/lib/quote-request/website-enquiry-display";
import {
  confirmWebsiteEnquiryContact,
  createCompanyForWebsiteEnquiry,
  createContactForWebsiteEnquiry,
  handleLinkWebsiteEnquiryCompany,
  linkWebsiteEnquiryCompany,
  WebsiteEnquiryError,
} from "@/lib/quote-request/website-enquiry-admin";

type Row = Record<string, unknown> & { id: string };

function createMemory(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    quote_requests: [],
    companies: [],
    contacts: [],
    quotes: [],
    opportunities: [],
    profiles: [],
    crm_activity: [],
    ...seed,
  };
  const mutations: Array<{ table: string; action: string; payload: Record<string, unknown> }> = [];
  let fromCalls = 0;

  function query(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filters: Array<(row: Row) => boolean> = [];
    let action: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> | null = null;
    let limitCount: number | null = null;

    const api = {
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return api;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return api;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (value == null ? row[column] == null : row[column] === value));
        return api;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      contains(column: string, value: Record<string, unknown>) {
        filters.push((row) => {
          const current = row[column];
          return (
            !!current &&
            typeof current === "object" &&
            Object.entries(value).every(
              ([key, expected]) => (current as Record<string, unknown>)[key] === expected
            )
          );
        });
        return api;
      },
      order() {
        return api;
      },
      limit(count: number) {
        limitCount = count;
        return api;
      },
      insert(next: Record<string, unknown>) {
        action = "insert";
        payload = next;
        return api;
      },
      update(next: Record<string, unknown>) {
        action = "update";
        payload = next;
        return api;
      },
      maybeSingle() {
        return execute("maybe");
      },
      single() {
        return execute("single");
      },
      then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
        return execute("many").then(resolve, reject);
      },
    };

    function matching() {
      const found = rows.filter((row) => filters.every((filter) => filter(row)));
      return limitCount == null ? found : found.slice(0, limitCount);
    }

    function execute(mode: "many" | "maybe" | "single") {
      if (action === "insert" && payload) {
        const row = { id: crypto.randomUUID(), ...payload } as Row;
        rows.push(row);
        mutations.push({ table, action, payload });
        return Promise.resolve({ data: mode === "many" ? [row] : row, error: null });
      }

      if (action === "update" && payload) {
        const found = matching();
        mutations.push({ table, action, payload });
        for (const row of found) {
          Object.assign(row, payload);
        }
        if (mode === "many") {
          return Promise.resolve({ data: found, error: null });
        }
        return Promise.resolve({
          data: found.length === 1 ? found[0] : null,
          error: found.length > 1 ? { message: "multiple" } : null,
        });
      }

      const found = matching();
      if (mode === "many") {
        return Promise.resolve({ data: found, error: null });
      }
      if (mode === "maybe") {
        return Promise.resolve({
          data: found.length === 1 ? found[0] : found.length === 0 ? null : null,
          error: found.length > 1 ? { message: "multiple" } : null,
        });
      }
      return Promise.resolve({
        data: found.length === 1 ? found[0] : null,
        error: found.length === 1 ? null : { message: "not one row" },
      });
    }

    return api;
  }

  const client = {
    from(table: string) {
      fromCalls += 1;
      return query(table);
    },
    auth: {
      admin: {
        inviteUserByEmail() {
          throw new Error("inviteUserByEmail was called.");
        },
      },
    },
  };

  return { client: client as unknown as SupabaseClient, tables, mutations, get fromCalls() { return fromCalls; } };
}

function websiteEnquiry(overrides: Row = {}): Row {
  return {
    id: "enquiry-1",
    source: "website",
    company_id: null,
    requested_by: null,
    opportunity_id: null,
    project_name: "Reception panels",
    description: "Two wall panels.",
    submitter_name: "Ada Lovelace",
    submitter_email: "ada@example.com",
    submitter_phone: "0121 000 0000",
    suggested_contact_id: "suggested-contact",
    suggested_company_id: "suggested-company",
    ...overrides,
  };
}

describe("website enquiry management", { concurrency: 1 }, () => {
  test("inbox and detail copy distinguish website, portal, and unlinked enquiries", () => {
    const website = buildQuoteRequestInboxRow({
      source: "website",
      projectName: "Reception panels",
      submitterName: "Ada Lovelace",
      submitterCompanyName: "Analytical Engines",
      requesterName: null,
      companyId: null,
      linkedCompanyName: null,
      requestStatus: "submitted",
      createdAt: "2026-10-20T08:00:00.000Z",
    });
    const portal = buildQuoteRequestInboxRow({
      source: "customer_portal",
      projectName: "Portal job",
      submitterName: null,
      submitterCompanyName: null,
      requesterName: "Known Person",
      companyId: "company-1",
      linkedCompanyName: "Pilot Co",
      requestStatus: "submitted",
      createdAt: "2026-10-20T08:00:00.000Z",
    });
    const details = websiteEnquiryDetailItems({
      submitterName: "Ada Lovelace",
      submitterCompanyName: null,
      submitterEmail: "ada@example.com",
      submitterPhone: null,
      projectName: "Reception panels",
      description: "Two wall panels.",
      requestedDateLabel: null,
      requestedTime: null,
      projectLocation: null,
      existingJobReference: null,
      artworkPending: false,
      submittedAtLabel: "20 Oct 2026",
      requestStatusLabel: "Submitted",
      linkedCompanyName: null,
      companyId: null,
    });

    assert.equal(website.sourceLabel, "Website");
    assert.equal(website.submitterName, "Ada Lovelace");
    assert.equal(website.submittedCompanyName, "Analytical Engines");
    assert.equal(website.companyLabel, "Unlinked");
    assert.equal(website.unlinked, true);
    assert.equal(portal.sourceLabel, "Customer portal");
    assert.equal(portal.submitterName, "Known Person");
    assert.equal(portal.companyLabel, "Pilot Co");
    assert.equal(portal.unlinked, false);
    assert.equal(details.some((item) => item.label === "Phone"), false);
    assert.equal(details.some((item) => item.label === "Requested date"), false);
    assert.equal(details.find((item) => item.label === "Linked company")?.value, "Unlinked");
    assert.equal(details.find((item) => item.label === "Artwork pending")?.value, "No");
    assert.equal(
      websiteSuggestionSummary({
        contactName: "Ada Lovelace",
        contactEmail: "ada@example.com",
        companyName: "Pilot Co",
      })?.note.includes("not linked"),
      true
    );
    assert.equal(websiteSuggestionSummary(null), null);
  });

  test("linking a company keeps the website source and does not confirm the suggestion", async () => {
    const memory = createMemory({
      quote_requests: [websiteEnquiry()],
      companies: [{ id: "company-2", company_name: "Other Co", is_active: true }],
    });

    const result = await linkWebsiteEnquiryCompany(memory.client, {
      quoteRequestId: "enquiry-1",
      companyId: "company-2",
      confirmed: true,
      actorProfileId: "staff-1",
    });
    const enquiry = memory.tables.quote_requests[0];

    assert.equal(result.alreadyLinked, false);
    assert.equal(enquiry.company_id, "company-2");
    assert.equal(enquiry.source, "website");
    assert.equal(enquiry.requested_by, null);
    assert.equal(enquiry.suggested_contact_id, "suggested-contact");
    assert.equal(enquiry.suggested_company_id, "suggested-company");
    assert.equal(
      memory.mutations.some(
        (mutation) =>
          mutation.table === "quote_requests" &&
          ("source" in mutation.payload ||
            "requested_by" in mutation.payload ||
            "suggested_contact_id" in mutation.payload)
      ),
      false
    );
    assert.equal(
      memory.tables.crm_activity.some(
        (activity) => activity.activity_type === "quote_request_company_linked"
      ),
      true
    );
  });

  test("company linking is refused without confirmation, for portal requests, and after an opportunity or quote exists", async () => {
    const memory = createMemory({
      quote_requests: [
        websiteEnquiry(),
        websiteEnquiry({ id: "portal-1", source: "customer_portal", company_id: "company-1", requested_by: "profile-1" }),
        websiteEnquiry({ id: "opp-enquiry", opportunity_id: "opp-1" }),
        websiteEnquiry({ id: "quote-enquiry" }),
      ],
      companies: [{ id: "company-2", company_name: "Other Co", is_active: true }],
      quotes: [{ id: "quote-1", quote_request_id: "quote-enquiry" }],
    });

    await assert.rejects(
      () =>
        linkWebsiteEnquiryCompany(memory.client, {
          quoteRequestId: "enquiry-1",
          companyId: "company-2",
          confirmed: false,
          actorProfileId: "staff-1",
        }),
      (error: unknown) => error instanceof WebsiteEnquiryError && error.status === 400
    );
    await assert.rejects(
      () =>
        linkWebsiteEnquiryCompany(memory.client, {
          quoteRequestId: "portal-1",
          companyId: "company-2",
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) => error instanceof WebsiteEnquiryError && error.status === 400
    );
    await assert.rejects(
      () =>
        linkWebsiteEnquiryCompany(memory.client, {
          quoteRequestId: "opp-enquiry",
          companyId: "company-2",
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) => error instanceof WebsiteEnquiryError && error.status === 409
    );
    await assert.rejects(
      () =>
        linkWebsiteEnquiryCompany(memory.client, {
          quoteRequestId: "quote-enquiry",
          companyId: "company-2",
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) => error instanceof WebsiteEnquiryError && error.status === 409
    );

    assert.equal(memory.tables.quote_requests[0].company_id, null);
    assert.equal(memory.tables.quote_requests[1].company_id, "company-1");
    assert.equal(memory.mutations.some((mutation) => mutation.action === "update"), false);
  });

  test("creating a company links it once and refuses a duplicate name", async () => {
    const memory = createMemory({
      quote_requests: [websiteEnquiry(), websiteEnquiry({ id: "enquiry-2" })],
      companies: [{ id: "existing-1", company_name: "Analytical Engines", is_active: true }],
    });

    await assert.rejects(
      () =>
        createCompanyForWebsiteEnquiry(memory.client, {
          quoteRequestId: "enquiry-2",
          companyName: "  analytical   engines ",
          paymentTermsDays: 14,
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) =>
        error instanceof WebsiteEnquiryError &&
        error.status === 409 &&
        error.existingCompanyId === "existing-1"
    );
    assert.equal(memory.tables.companies.length, 1);

    const created = await createCompanyForWebsiteEnquiry(memory.client, {
      quoteRequestId: "enquiry-1",
      companyName: "New Panels Ltd",
      accountsEmail: "ada@example.com",
      phone: "0121 000 0000",
      paymentTermsDays: 14,
      confirmed: true,
      actorProfileId: "staff-1",
    });
    const enquiry = memory.tables.quote_requests.find((row) => row.id === "enquiry-1");

    assert.equal(enquiry?.company_id, created.companyId);
    assert.equal(enquiry?.source, "website");
    assert.equal(enquiry?.requested_by, null);
    assert.equal(memory.tables.companies.filter((company) => company.company_name === "New Panels Ltd").length, 1);
  });

  test("a created company is kept when the enquiry can no longer be linked", async () => {
    const memory = createMemory({ quote_requests: [websiteEnquiry()] });
    const originalFrom = memory.client.from.bind(memory.client);
    memory.client.from = ((table: string) => {
      const builder = originalFrom(table);
      if (table === "companies") {
        const insert = builder.insert.bind(builder);
        builder.insert = (payload: Record<string, unknown>) => {
          memory.tables.quote_requests[0].opportunity_id = "opp-raced";
          return insert(payload);
        };
      }
      return builder;
    }) as typeof memory.client.from;

    await assert.rejects(
      () =>
        createCompanyForWebsiteEnquiry(memory.client, {
          quoteRequestId: "enquiry-1",
          companyName: "Raced Ltd",
          paymentTermsDays: 14,
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) =>
        error instanceof WebsiteEnquiryError &&
        error.status === 409 &&
        Boolean(error.companyId)
    );
    assert.equal(memory.tables.quote_requests[0].company_id, null);
    assert.equal(memory.tables.companies.length, 1);
  });

  test("contact confirmation and creation stay inside the linked company and do not create a portal account", async () => {
    const memory = createMemory({
      quote_requests: [websiteEnquiry({ company_id: "company-1" })],
      companies: [{ id: "company-1", company_name: "Pilot Co", is_active: true }],
      contacts: [
        {
          id: "contact-1",
          company_id: "company-1",
          full_name: "Existing Person",
          email: "existing@example.com",
          is_active: true,
          profile_id: null,
        },
        {
          id: "contact-other",
          company_id: "company-2",
          full_name: "Other Person",
          email: "other@example.com",
          is_active: true,
          profile_id: null,
        },
      ],
    });

    await assert.rejects(
      () =>
        confirmWebsiteEnquiryContact(memory.client, {
          quoteRequestId: "enquiry-1",
          contactId: "contact-other",
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) => error instanceof WebsiteEnquiryError && error.status === 400
    );

    await confirmWebsiteEnquiryContact(memory.client, {
      quoteRequestId: "enquiry-1",
      contactId: "contact-1",
      confirmed: true,
      actorProfileId: "staff-1",
    });

    await assert.rejects(
      () =>
        createContactForWebsiteEnquiry(memory.client, {
          quoteRequestId: "enquiry-1",
          fullName: "Ada Lovelace",
          email: "existing@example.com",
          confirmed: true,
          actorProfileId: "staff-1",
        }),
      (error: unknown) =>
        error instanceof WebsiteEnquiryError && error.duplicateContactId === "contact-1"
    );

    const created = await createContactForWebsiteEnquiry(memory.client, {
      quoteRequestId: "enquiry-1",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "0121 000 0000",
      confirmed: true,
      actorProfileId: "staff-1",
    });
    const contact = memory.tables.contacts.find((row) => row.id === created.contactId);

    assert.equal(contact?.company_id, "company-1");
    assert.equal("profile_id" in (contact ?? {}), false);
    assert.equal(memory.tables.quote_requests[0].suggested_contact_id, "suggested-contact");
    assert.equal(
      memory.tables.crm_activity.some(
        (activity) => activity.activity_type === "quote_request_contact_confirmed" && activity.contact_id === created.contactId
      ),
      true
    );
    assert.equal(memory.mutations.some((mutation) => mutation.table === "profiles"), false);
  });

  test("a customer or non-admin cannot link a company", async () => {
    let used = false;
    const response = await handleLinkWebsiteEnquiryCompany(
      new Request("https://os.candidcreative.uk/api/admin/quote-requests/enquiry-1/link-company", {
        method: "POST",
        body: JSON.stringify({ companyId: "company-1", confirmed: true }),
      }),
      "enquiry-1",
      {
        createSupabase: async () =>
          ({
            from() {
              used = true;
              throw new Error("Database was used.");
            },
          }) as unknown as SupabaseClient,
        verifyAdmin: async () => ({ ok: false, status: 403, message: "Forbidden." }),
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden." });
    assert.equal(used, false);
  });

  test("opportunity creation keeps a website enquiry unlinked from a portal account", async () => {
    const previousOwner = process.env.CRM_DEFAULT_OWNER_PROFILE_ID;
    process.env.CRM_DEFAULT_OWNER_PROFILE_ID = "staff-1";
    const memory = createMemory({
      quote_requests: [
        websiteEnquiry({ company_id: "company-1" }),
        websiteEnquiry({
          id: "portal-1",
          source: "customer_portal",
          company_id: "company-1",
          requested_by: "profile-1",
          suggested_contact_id: null,
          suggested_company_id: null,
        }),
      ],
      companies: [{ id: "company-1", company_name: "Pilot Co", is_active: true }],
      contacts: [
        {
          id: "contact-1",
          company_id: "company-1",
          full_name: "Ada Lovelace",
          email: "ada@example.com",
          is_active: true,
          profile_id: null,
        },
      ],
      profiles: [{ id: "staff-1", account_status: "approved", user_role: "admin" }],
    });

    try {
      await assert.rejects(
        () =>
          createOpportunityFromQuoteRequest(memory.client, {
            quoteRequestId: "enquiry-1",
            actorProfileId: "staff-1",
            contactId: null,
          }),
        /Choose a contact/
      );

      const website = await createOpportunityFromQuoteRequest(memory.client, {
        quoteRequestId: "enquiry-1",
        actorProfileId: "staff-1",
        contactId: "contact-1",
      });
      const portal = await createOpportunityFromQuoteRequest(memory.client, {
        quoteRequestId: "portal-1",
        actorProfileId: "staff-1",
        contactId: null,
      });
      const websiteOpportunity = memory.tables.opportunities.find((row) => row.id === website.opportunityId);
      const portalOpportunity = memory.tables.opportunities.find((row) => row.id === portal.opportunityId);
      const websiteEnquiryRow = memory.tables.quote_requests.find((row) => row.id === "enquiry-1");
      const websiteActivity = memory.tables.crm_activity.find(
        (row) => row.activity_type === "opportunity_created" && (row.metadata as { quote_request_id?: string }).quote_request_id === "enquiry-1"
      );

      assert.equal(websiteOpportunity?.source, "other");
      assert.equal(websiteOpportunity?.contact_id, "contact-1");
      assert.equal(websiteOpportunity?.company_id, "company-1");
      assert.equal((websiteActivity?.metadata as { enquiry_source?: string }).enquiry_source, "website");
      assert.equal(websiteEnquiryRow?.source, "website");
      assert.equal(websiteEnquiryRow?.requested_by, null);
      assert.equal(websiteEnquiryRow?.opportunity_id, website.opportunityId);
      assert.equal(portalOpportunity?.source, "customer_portal");
      assert.equal(portalOpportunity?.contact_id, null);
    } finally {
      if (previousOwner === undefined) {
        delete process.env.CRM_DEFAULT_OWNER_PROFILE_ID;
      } else {
        process.env.CRM_DEFAULT_OWNER_PROFILE_ID = previousOwner;
      }
    }
  });

  test("customer quote-request visibility still requires a portal source", async () => {
    const migration = await readFile(
      new URL("../../supabase/migrations/20261020100000_website_quote_requests.sql", import.meta.url),
      "utf8"
    );
    const adminRoutes = await readFile(
      new URL("../../app/api/admin/quote-requests/[id]/link-company/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(migration, /source = 'customer_portal'/);
    assert.match(adminRoutes, /handleLinkWebsiteEnquiryCompany/);
    assert.equal(adminRoutes.includes("inviteUserByEmail"), false);
  });
});
