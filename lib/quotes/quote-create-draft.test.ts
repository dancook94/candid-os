import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  QUOTE_CREATE_DRAFT_MIGRATION_FILE,
  QUOTE_CREATE_DRAFT_RPC,
  QUOTE_CREATE_DRAFT_RPC_REGPROCEDURE,
  readQuoteCreateDraftMigrationContract,
} from "@/lib/quotes/quote-create-draft";
import { QUOTE_NUMBER_ADVISORY_LOCK_KEY } from "@/lib/quotes/quote-number-allocation";
import { REPEAT_QUOTE_MIGRATION_FILE } from "@/lib/quotes/repeat-quote";

test("create admin quote draft migration uses locked allocator in one transaction", () => {
  const sql = readFileSync(QUOTE_CREATE_DRAFT_MIGRATION_FILE, "utf8");
  const contract = readQuoteCreateDraftMigrationContract(sql);
  const repeatSql = readFileSync(REPEAT_QUOTE_MIGRATION_FILE, "utf8");

  assert.equal(contract.hasCreateRpc, true);
  assert.equal(contract.usesAllocateNextQuoteNumber, true);
  assert.equal(contract.enforcesAdminCheck, true);
  assert.equal(contract.requiresIdempotencyKey, true);
  assert.equal(contract.hasIdempotencyTable, true);
  assert.equal(contract.hasIdempotencyGrants, true);
  assert.equal(contract.isSecurityInvoker, true);
  assert.equal(contract.singleTransactionInsertsQuoteAndVersion, true);

  assert.match(repeatSql, new RegExp(`pg_advisory_xact_lock\\(${QUOTE_NUMBER_ADVISORY_LOCK_KEY}\\)`));
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_admin_quote_draft/);
  assert.doesNotMatch(sql, /GRANT .* TO anon|GRANT .* TO PUBLIC/);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/);
});

test("quote builder uses create_admin_quote_draft instead of client max+1", () => {
  const form = readFileSync("components/quote-builder-form.tsx", "utf8");

  assert.match(form, new RegExp(QUOTE_CREATE_DRAFT_RPC));
  assert.match(form, /p_idempotency_key/);
  assert.doesNotMatch(form, /getNextQuoteNumber/);
  assert.doesNotMatch(form, /\.from\("quotes"\)\s*\n\s*\.insert\(/);
});

test("create admin quote draft handles validation failures and idempotent retries", () => {
  const sql = readFileSync(QUOTE_CREATE_DRAFT_MIGRATION_FILE, "utf8");

  assert.match(sql, /Company must be active before a quote can be created/);
  assert.match(sql, /Contact must be active and belong to this company/);
  assert.match(sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(sql, /created_quote_id IS NOT NULL/);
  assert.match(
    sql,
    /SET created_quote_id = NULL[\s\S]*WHERE idempotency_key = p_idempotency_key/
  );
});

test("create admin quote draft RPC signature matches smoke test regprocedure", () => {
  const sql = readFileSync(QUOTE_CREATE_DRAFT_MIGRATION_FILE, "utf8");
  const docs = readFileSync(
    "docs/test-release-purchasing-quoting-migrations.md",
    "utf8"
  );
  const argList = QUOTE_CREATE_DRAFT_RPC_REGPROCEDURE.replace(
    /^public\.create_admin_quote_draft\(/,
    ""
  ).replace(/\)$/, "");

  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.create_admin_quote_draft\\(\\s*${argList.replace(/[()]/g, "\\$&").replace(/,/g, ",\\s*")}`));
  assert.match(docs, new RegExp(QUOTE_CREATE_DRAFT_RPC_REGPROCEDURE.replace(/[()]/g, "\\$&")));
});

test("new quote create runs RPC before optional opportunity auto-create", () => {
  const form = readFileSync("components/quote-builder-form.tsx", "utf8");
  const createStart = form.indexOf('if (mode === "create")');
  assert.ok(createStart >= 0, "expected create-mode block in quote builder");
  const createBlock = form.slice(createStart, createStart + 6000);

  const rpcIndex = createBlock.indexOf(
    'supabase.rpc(\n          "create_admin_quote_draft"'
  );
  const opportunityIndex = createBlock.indexOf(
    '"/api/crm/opportunities/create-for-quote"'
  );
  assert.ok(rpcIndex >= 0);
  assert.ok(opportunityIndex >= 0);
  assert.ok(rpcIndex < opportunityIndex);
});

test("rollbackCreatedQuote surfaces delete failures", () => {
  const form = readFileSync("components/quote-builder-form.tsx", "utf8");
  const rollback = /async function rollbackCreatedQuote\([\s\S]*?\n  \}/m.exec(form)?.[0];

  assert.ok(rollback);
  assert.match(rollback!, /if \(itemsError\)/);
  assert.match(rollback!, /if \(versionError\)/);
  assert.match(rollback!, /if \(quoteError\)/);
});

test("concurrent allocation uses the shared advisory lock inside allocate_next_quote_number", () => {
  const repeatSql = readFileSync(REPEAT_QUOTE_MIGRATION_FILE, "utf8");
  const createSql = readFileSync(QUOTE_CREATE_DRAFT_MIGRATION_FILE, "utf8");

  assert.match(
    repeatSql,
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.allocate_next_quote_number\\([\\s\\S]*?pg_advisory_xact_lock\\(${QUOTE_NUMBER_ADVISORY_LOCK_KEY}\\)`
    )
  );
  assert.match(createSql, /v_next_number := public\.allocate_next_quote_number\(\)/);
  assert.doesNotMatch(createSql, /pg_advisory_xact_lock/);
});

test("repeat quote and standard create share allocate_next_quote_number", () => {
  const createSql = readFileSync(QUOTE_CREATE_DRAFT_MIGRATION_FILE, "utf8");
  const repeatSql = readFileSync(REPEAT_QUOTE_MIGRATION_FILE, "utf8");

  assert.match(createSql, /allocate_next_quote_number\(\)/);
  assert.match(repeatSql, /allocate_next_quote_number\(\)/);
});
