import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  QUOTE_NUMBER_COLLISION_REPORT,
  QUOTE_NUMBER_ADVISORY_LOCK_KEY,
} from "@/lib/quotes/quote-number-allocation";
import {
  REPEAT_QUOTE_GRANTS_MIGRATION_FILE,
  REPEAT_QUOTE_MIGRATION_FILE,
  readRepeatQuoteMigrationContract,
  readRepeatQuotePermissionsContract,
  repeatQuoteRefreshFlag,
} from "@/lib/quotes/repeat-quote";

test("repeat quote migration defines RPC, lineage, idempotency and allocator", () => {
  const sql = readFileSync(REPEAT_QUOTE_MIGRATION_FILE, "utf8");
  const contract = readRepeatQuoteMigrationContract(sql);

  assert.equal(contract.hasRepeatRpc, true);
  assert.equal(contract.hasAllocator, true);
  assert.equal(contract.hasIdempotencyTable, true);
  assert.equal(contract.hasLineageColumns, true);
  assert.equal(contract.doesNotUpdateSourceQuote, true);
  assert.equal(contract.grantsAuthenticatedOnly, true);
  assert.match(sql, /quote_repeat_refresh_material_component/);
  assert.match(sql, /pricing_source = 'catalogue'/);
  assert.match(sql, /component\.supplier_reference/);
  assert.match(sql, /quote_request_id,\s*\n\s*opportunity_id,/);
  assert.match(sql, /NULL,\s*\n\s*NULL,\s*\n\s*v_source_quote\.project_name/);
});

test("material pricing mode maps to refresh flag", () => {
  assert.equal(repeatQuoteRefreshFlag("refresh_catalogue"), true);
  assert.equal(repeatQuoteRefreshFlag("keep_saved"), false);
});

test("manual create uses transactional allocator via create_admin_quote_draft", () => {
  const form = readFileSync("components/quote-builder-form.tsx", "utf8");
  assert.match(form, /create_admin_quote_draft/);
  assert.doesNotMatch(form, /getNextQuoteNumber/);
  assert.equal(QUOTE_NUMBER_ADVISORY_LOCK_KEY, 89_124_001);
  assert.match(QUOTE_NUMBER_COLLISION_REPORT.manualCreate, /create_admin_quote_draft/);
});

test("customer and PDF paths do not load internal quote costs", () => {
  const files = [
    "lib/customer-formal-quote-data.ts",
    "lib/generate-customer-quote-pdf.ts",
    "app/api/admin/quotes/[id]/repeat/route.ts",
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("quote_item_costs"), false, file);
    assert.equal(source.includes("quote_item_material_components"), false, file);
  }
});

test("repeat quote idempotency table grants work with invoker RPC and admin RLS", () => {
  const repeatSql = readFileSync(REPEAT_QUOTE_MIGRATION_FILE, "utf8");
  const grantsSql = readFileSync(REPEAT_QUOTE_GRANTS_MIGRATION_FILE, "utf8");
  const permissions = readRepeatQuotePermissionsContract(repeatSql, grantsSql);

  assert.equal(permissions.repeatQuoteIsSecurityInvoker, true);
  assert.equal(permissions.repeatQuoteEnforcesAdminCheck, true);
  assert.equal(permissions.idempotencyTableHasAdminRls, true);
  assert.equal(permissions.idempotencyTableHasAuthenticatedGrants, true);
  assert.equal(permissions.doesNotDisableRls, true);
  assert.equal(permissions.doesNotGrantUnrestrictedAccess, true);

  assert.doesNotMatch(
    repeatSql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.quote_repeat_requests/
  );
  assert.match(
    grantsSql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.quote_repeat_requests TO authenticated/
  );
  assert.match(
    grantsSql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.quote_repeat_requests TO service_role/
  );
  assert.doesNotMatch(grantsSql, /GRANT DELETE ON TABLE public\.quote_repeat_requests/);
  assert.doesNotMatch(grantsSql, /DISABLE ROW LEVEL SECURITY/);
});

test("repeat quote UI and API exist", () => {
  const page = readFileSync("app/admin/quotes/[id]/page.tsx", "utf8");
  assert.match(page, /RepeatQuoteButton/);
  assert.match(page, /QuoteRepeatLineagePanel/);

  const route = readFileSync("app/api/admin/quotes/[id]/repeat/route.ts", "utf8");
  assert.match(route, /repeat_quote/);
  assert.match(route, /validateActiveContactForCompany/);
});
