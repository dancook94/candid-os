import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { computeDeadlineFlags } from "@/lib/production/board";
import {
  applyRequiredDateToJobBoardCard,
  formatProductionBoardDeadline,
  normalizeProductionDeadlineDate,
  resolveJobRequiredDateFromQuoteSources,
  resolveQuoteProductionDeadlineForSave,
} from "@/lib/jobs/production-deadline";
import type { JobProductionBoardCard } from "@/lib/production/job-board-service";

function buildBoardCard(
  overrides?: Partial<JobProductionBoardCard>
): JobProductionBoardCard {
  return {
    id: "job-1",
    job_reference: "J-100",
    project_name: "Test project",
    company_id: "company-1",
    company_name: "Test Co",
    production_board_stage: "ready_to_print",
    status: "in_production",
    fulfilment_method: null,
    required_date: null,
    artwork_status_label: "Awaiting artwork",
    readiness_label: "Not ready",
    readiness_satisfied: 0,
    readiness_active: 1,
    readiness_is_ready: false,
    ripped_requirements_count: 0,
    files_detected_count: 0,
    priority_label: null,
    assigned_staff_name: null,
    proof_status_label: "Not required",
    proof_status: "not_required",
    proof_status_badge: "disabled",
    readiness_unresolved_details: [],
    synology_path_hint: null,
    dropbox_folder_path: null,
    dropbox_setup_status: "pending",
    opportunity_id: null,
    quote_id: "quote-1",
    job_billing_type: "billable",
    billing_type_label: "Billable",
    updated_at: "2026-09-01T10:00:00.000Z",
    is_overdue: false,
    is_due_today: false,
    is_due_tomorrow: false,
    is_on_hold: false,
    preview_thumbnail_url: null,
    preview_thumbnail_alt: null,
    preview_is_shared_print: false,
    preview_printfactory_job_guid: null,
    preview_output_page_count: 0,
    ...overrides,
  };
}

describe("resolveQuoteProductionDeadlineForSave", () => {
  it("stores quotes.required_date for internal quotes without a quote request", () => {
    assert.equal(
      resolveQuoteProductionDeadlineForSave({
        quoteRequestId: null,
        productionDeadline: "2026-09-12",
      }),
      "2026-09-12"
    );
  });

  it("does not store a quote deadline when linked to a quote request", () => {
    assert.equal(
      resolveQuoteProductionDeadlineForSave({
        quoteRequestId: "qr-1",
        productionDeadline: "2026-09-12",
      }),
      null
    );
  });
});

describe("resolveJobRequiredDateFromQuoteSources", () => {
  it("copies internal quotes.required_date when no quote request is linked", () => {
    assert.equal(
      resolveJobRequiredDateFromQuoteSources({
        quoteRequestId: null,
        quoteRequestRequiredDate: null,
        quoteRequiredDate: "2026-09-15",
      }),
      "2026-09-15"
    );
  });

  it("leaves jobs.required_date null for internal quotes without a deadline", () => {
    assert.equal(
      resolveJobRequiredDateFromQuoteSources({
        quoteRequestId: null,
        quoteRequestRequiredDate: null,
        quoteRequiredDate: null,
      }),
      null
    );
  });

  it("preserves customer quote request required_date behaviour", () => {
    assert.equal(
      resolveJobRequiredDateFromQuoteSources({
        quoteRequestId: "qr-1",
        quoteRequestRequiredDate: "2026-09-20",
        quoteRequiredDate: "2026-09-12",
      }),
      "2026-09-20"
    );
  });

  it("keeps customer path null when the quote request has no requested date", () => {
    assert.equal(
      resolveJobRequiredDateFromQuoteSources({
        quoteRequestId: "qr-1",
        quoteRequestRequiredDate: null,
        quoteRequiredDate: "2026-09-12",
      }),
      null
    );
  });
});

describe("normalizeProductionDeadlineDate", () => {
  it("sets a job deadline date", () => {
    assert.equal(normalizeProductionDeadlineDate("2026-09-12"), "2026-09-12");
  });

  it("clears a job deadline date", () => {
    assert.equal(normalizeProductionDeadlineDate(""), null);
    assert.equal(normalizeProductionDeadlineDate(null), null);
  });
});

describe("formatProductionBoardDeadline", () => {
  it("formats a production board deadline label", () => {
    const formatted = formatProductionBoardDeadline("2026-09-12");
    assert.match(formatted, /^Due: /);
    assert.match(formatted, /12 Sep/);
  });

  it('shows "No deadline set" when null', () => {
    assert.equal(formatProductionBoardDeadline(null), "No deadline set");
  });
});

describe("applyRequiredDateToJobBoardCard", () => {
  it("recomputes overdue flags after a deadline update", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isoDate = yesterday.toISOString().slice(0, 10);

    const updated = applyRequiredDateToJobBoardCard(buildBoardCard(), isoDate);

    assert.equal(updated.required_date, isoDate);
    assert.equal(updated.is_overdue, true);
  });
});

describe("computeDeadlineFlags", () => {
  it("marks today deadlines correctly when the due time is still ahead", () => {
    const dueLaterToday = new Date(Date.now() + 60 * 60 * 1000);
    const flags = computeDeadlineFlags(dueLaterToday.toISOString(), "printing");

    assert.equal(flags.is_due_today, true);
    assert.equal(flags.is_overdue, false);
  });
});

describe("production deadline staff endpoint", () => {
  it("requires approved CRM staff and is admin-only", async () => {
    const routeSource = await readFile(
      new URL("../../app/api/admin/jobs/[id]/required-date/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(routeSource, /verifyApprovedCrmStaff/);
    assert.match(routeSource, /revalidatePath\(`\/admin\/jobs\/\$\{jobId\}`\)/);
    assert.doesNotMatch(routeSource, /app\/api\/customer/);
  });
});

describe("internal quote builder persistence", () => {
  it("writes quotes.required_date from the production deadline field", async () => {
    const formSource = await readFile(
      new URL("../../components/quote-builder-form.tsx", import.meta.url),
      "utf8"
    );

    assert.match(formSource, /resolveQuoteProductionDeadlineForSave/);
    assert.match(formSource, /required_date: quoteRequiredDate/);
    assert.match(formSource, /Production deadline/);
    assert.match(formSource, /The date production needs this job completed by\./);
  });
});

describe("quotes.required_date schema usage", () => {
  it("is selected by existing notification code and create-from-quote", async () => {
    const notificationSource = await readFile(
      new URL("../notifications/triggers.ts", import.meta.url),
      "utf8"
    );
    const createFromQuoteSource = await readFile(
      new URL("./create-from-quote.ts", import.meta.url),
      "utf8"
    );

    assert.match(notificationSource, /quotes[\s\S]*required_date/);
    assert.match(createFromQuoteSource, /required_date/);
  });
});
