import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { collectAttachments, decodeGmailBase64Url } from "@/lib/gmail/attachments";
import { classifyPdfText } from "@/lib/gmail/classify";
import { decryptGmailRefreshToken, encryptGmailRefreshToken } from "@/lib/gmail/crypto";
import {
  buildGmailAuthorizeUrl,
  createGmailOAuthState,
  gmailOAuthCallbackStateAccepted,
  gmailScopeIsReadOnly,
  refreshGmailAccessToken,
  verifyGmailOAuthState,
} from "@/lib/gmail/oauth";
import { planOtherAttachment, planPdfDiscovery } from "@/lib/gmail/plan";
import { buildGmailDiscoveryQuery } from "@/lib/gmail/query";

test("classifies supplier document headings", () => {
  assert.equal(classifyPdfText("SALES INVOICE\nInvoice No. 146237"), "invoice");
  assert.equal(classifyPdfText("SALES ORDER\nOrder confirmation 170505"), "sales_order");
  assert.equal(classifyPdfText("CREDIT NOTE\nCN100"), "credit_note");
  assert.equal(classifyPdfText("DELIVERY NOTE\nDN100"), "delivery_note");
  assert.equal(classifyPdfText("PROFORMA INVOICE\nPF100"), "unknown");
  assert.equal(classifyPdfText("Price list\nFoam board"), "unknown");
  assert.equal(
    classifyPdfText("SALES INVOICE\nInvoice No. 1\nRelated sales order 99"),
    "invoice"
  );
  assert.equal(
    classifyPdfText("SALES ORDER\nThis order mentions the word invoice later"),
    "sales_order"
  );
});

test("searches inbox, archive and sent without spam or trash", () => {
  const query = buildGmailDiscoveryQuery("2026-07-12", "2026-10-12");

  assert.match(query, /-in:spam/);
  assert.match(query, /-in:trash/);
  assert.match(query, /-in:drafts/);
  assert.match(query, /-in:chats/);
  assert.match(query, /after:2026\/07\/11/);
  assert.match(query, /before:2026\/10\/13/);
  assert.doesNotMatch(query, /in:inbox/);
  assert.doesNotMatch(query, /in:anywhere/);
  assert.throws(() => buildGmailDiscoveryQuery("2026-10-12", "2026-07-12"));
});

test("encrypts a refresh token with the configured key", () => {
  const previous = process.env.GMAIL_TOKEN_KEY;
  process.env.GMAIL_TOKEN_KEY = randomBytes(32).toString("base64");

  try {
    const token = "refresh-token-value";
    const stored = encryptGmailRefreshToken(token);

    assert.notEqual(stored, token);
    assert.equal(decryptGmailRefreshToken(stored), token);
    process.env.GMAIL_TOKEN_KEY = randomBytes(32).toString("base64");
    assert.throws(() => decryptGmailRefreshToken(stored));
    process.env.GMAIL_TOKEN_KEY = Buffer.from("short").toString("base64");
    assert.throws(() => encryptGmailRefreshToken(token), /32 bytes/);
  } finally {
    process.env.GMAIL_TOKEN_KEY = previous;
  }
});

test("rejects an invalid, expired, or mismatched OAuth callback", () => {
  const previous = process.env.GMAIL_CLIENT_SECRET;
  process.env.GMAIL_CLIENT_SECRET = "client-secret";

  try {
    const state = createGmailOAuthState();
    const expired = createGmailOAuthState(Date.now() - 1000);
    const [body] = state.split(".");
    const tampered = `${body}.not-the-signature`;

    assert.equal(gmailOAuthCallbackStateAccepted(state, state), true);
    assert.equal(gmailOAuthCallbackStateAccepted(null, state), false);
    assert.equal(gmailOAuthCallbackStateAccepted(state, undefined), false);
    assert.equal(gmailOAuthCallbackStateAccepted(tampered, tampered), false);
    assert.equal(gmailOAuthCallbackStateAccepted(expired, expired), false);
    assert.equal(gmailOAuthCallbackStateAccepted(state, createGmailOAuthState()), false);
    assert.equal(verifyGmailOAuthState(expired), false);
    assert.equal(gmailScopeIsReadOnly("https://www.googleapis.com/auth/gmail.readonly"), true);
    assert.equal(
      gmailScopeIsReadOnly(
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify"
      ),
      false
    );
  } finally {
    process.env.GMAIL_CLIENT_SECRET = previous;
  }
});

test("stores a rotated refresh token and reports a revoked grant", async () => {
  const previous = {
    id: process.env.GMAIL_CLIENT_ID,
    secret: process.env.GMAIL_CLIENT_SECRET,
    fetch: globalThis.fetch,
  };
  process.env.GMAIL_CLIENT_ID = "client-id";
  process.env.GMAIL_CLIENT_SECRET = "client-secret";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const refreshed = await refreshGmailAccessToken("refresh-1");
    assert.equal(refreshed.accessToken, "access-2");
    assert.equal(refreshed.refreshToken, "refresh-2");

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await assert.rejects(refreshGmailAccessToken("refresh-1"), (error: Error & { code?: string }) => {
      assert.equal(error.code, "invalid_grant");
      assert.doesNotMatch(error.message, /refresh-1/);
      return true;
    });
  } finally {
    process.env.GMAIL_CLIENT_ID = previous.id;
    process.env.GMAIL_CLIENT_SECRET = previous.secret;
    globalThis.fetch = previous.fetch;
  }
});

test("requests read-only Gmail access", () => {
  const previous = {
    id: process.env.GMAIL_CLIENT_ID,
    secret: process.env.GMAIL_CLIENT_SECRET,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
  process.env.GMAIL_CLIENT_ID = "client-id";
  process.env.GMAIL_CLIENT_SECRET = "client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://os.candidcreative.uk";

  try {
    const state = createGmailOAuthState();
    const url = new URL(buildGmailAuthorizeUrl(state));

    assert.equal(verifyGmailOAuthState(state), true);
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("include_granted_scopes"), "false");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "https://os.candidcreative.uk/api/admin/materials/invoices/gmail/callback"
    );
    assert.doesNotMatch(url.searchParams.get("scope") ?? "", /gmail\.(modify|compose|send)/);
  } finally {
    process.env.GMAIL_CLIENT_ID = previous.id;
    process.env.GMAIL_CLIENT_SECRET = previous.secret;
    process.env.NEXT_PUBLIC_APP_URL = previous.appUrl;
  }
});

test("plans discovery without creating a second copy of a known file", () => {
  const duplicate = planPdfDiscovery({
    text: "SALES INVOICE\nInvoice No. 1",
    extractFailed: false,
    byteSize: 100,
    manualInvoiceId: "invoice-1",
    existingDiscoveryItemId: null,
  });
  const credit = planPdfDiscovery({
    text: "CREDIT NOTE\nCN1",
    extractFailed: false,
    byteSize: 100,
    manualInvoiceId: null,
    existingDiscoveryItemId: null,
  });
  const unreadable = planPdfDiscovery({
    text: null,
    extractFailed: true,
    byteSize: 100,
    manualInvoiceId: null,
    existingDiscoveryItemId: null,
  });
  const image = planOtherAttachment("image", 100);

  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.storeFile, false);
  assert.equal(duplicate.duplicateInvoiceId, "invoice-1");
  assert.equal(credit.documentType, "credit_note");
  assert.equal(credit.status, "stored");
  assert.equal(credit.storeFile, true);
  assert.match(credit.detail ?? "", /not created as a supplier invoice/);
  assert.equal(unreadable.status, "failed");
  assert.equal(unreadable.storeFile, true);
  assert.equal(image.documentType, "unsupported_image");
  assert.equal(image.status, "recorded");
  assert.match(image.detail, /was not read/);
});

test("collects nested attachments and decodes Gmail base64url", () => {
  const attachments = collectAttachments({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: "aGVsbG8" } },
      {
        filename: "order.pdf",
        mimeType: "application/pdf",
        body: { attachmentId: "pdf-1", size: 20 },
        parts: [
          {
            filename: "photo.jpg",
            mimeType: "image/jpeg",
            body: { attachmentId: "img-1", size: 10 },
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    attachments.map((item) => [item.filename, item.kind]),
    [
      ["order.pdf", "pdf"],
      ["photo.jpg", "image"],
    ]
  );
  assert.equal(decodeGmailBase64Url("aGVsbG8").toString("utf8"), "hello");
});

test("discovery code does not create invoices, materials, or prices", async () => {
  const directory = new URL(".", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".ts") && name !== "gmail.test.ts");
  const sources = await Promise.all(names.map((name) => readFile(new URL(name, directory), "utf8")));
  const migrations = await Promise.all(
    [
      "../../supabase/migrations/20261012194500_gmail_discovery.sql",
      "../../supabase/migrations/20261012201000_gmail_discovery_lease.sql",
      "../../supabase/migrations/20261012211000_gmail_sync_checkpoint.sql",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
  );
  const discovery = await readFile(new URL("./discovery.ts", import.meta.url), "utf8");
  const combined = `${sources.join("\n")}\n${migrations.join("\n")}`;

  assert.doesNotMatch(combined, /from\("supplier_invoices"\)/);
  assert.doesNotMatch(combined, /from\("material_prices"\)/);
  assert.doesNotMatch(combined, /from\("materials"\)/);
  assert.doesNotMatch(combined, /resolve_invoice_price_change|create_material_from_invoice_line/);
  assert.doesNotMatch(combined, /console\.(log|info|debug|warn|error)/);
  assert.match(migrations[0], /REVOKE ALL ON TABLE public\.gmail_connection_secrets FROM PUBLIC, anon, authenticated/);
  assert.match(migrations[0], /'gmail-import-files',\s*'gmail-import-files',\s*false/);
  assert.doesNotMatch(migrations[0], /GRANT SELECT ON public\.gmail_connection_secrets/);
  assert.match(combined, /from\("supplier_invoice_files"\)/);
  assert.match(discovery, /resolveInvoiceSupplier\(null/);
  assert.doesNotMatch(discovery, /headers\.from|payload\.from|email from/i);
  assert.match(migrations[1], /claim_gmail_discovery_run/);
  assert.match(migrations[1], /REVOKE ALL ON FUNCTION public\.claim_gmail_discovery_run/);
  assert.match(migrations[2], /gmail_sync_checkpoints_disabled_until_approval/);
  assert.match(migrations[2], /CHECK \(enabled = false\)/);
});
