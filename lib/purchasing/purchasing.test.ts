import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { resolvePurchasingPageAccess } from "@/lib/purchasing/access";
import {
  createDraftErrorCode,
  createDraftErrorMessage,
  purchaseOrderCreateErrorLog,
  purchaseOrderIdFromCreateResult,
  recentDuplicateDraftId,
} from "@/lib/purchasing/create-draft";
import {
  applySavedDraft,
  buildPurchaseOrderDraftPayload,
  emptyCatalogueLine,
  emptyManualLine,
  payloadFieldNames,
  saveDraftErrorMessage,
  validateDraft,
  type EditorDraft,
} from "@/lib/purchasing/draft-editor";
import { issueErrorMessage, validateIssueReady } from "@/lib/purchasing/issue";
import { toPurchaseOrderDetail } from "@/lib/purchasing/purchase-order-detail";
import {
  purchaseOrderPdfFilename,
  renderPurchaseOrderPdf,
} from "@/lib/purchasing/purchase-order-pdf";
import {
  formatPurchaseOrderDate,
  toPurchaseOrderListItem,
  type PurchaseOrderListItem,
} from "@/lib/purchasing/purchase-orders";
import { filterPurchasingSuppliers } from "@/lib/purchasing/suppliers";

const approvedAdmin = {
  account_status: "approved",
  user_role: "admin",
};

describe("purchasing page access", () => {
  it("sends signed-out visitors to login", () => {
    assert.equal(
      resolvePurchasingPageAccess({
        hasUser: false,
        profile: null,
        profileError: false,
        canIssuePurchaseOrders: false,
      }),
      "login"
    );
  });

  it("allows approved admins when the database permission is true", () => {
    assert.equal(
      resolvePurchasingPageAccess({
        hasUser: true,
        profile: approvedAdmin,
        profileError: false,
        canIssuePurchaseOrders: true,
      }),
      "allow"
    );
  });

  it("allows approved production staff only when they can issue purchase orders", () => {
    const production = {
      account_status: "approved",
      user_role: "production",
    };

    assert.equal(
      resolvePurchasingPageAccess({
        hasUser: true,
        profile: production,
        profileError: false,
        canIssuePurchaseOrders: true,
      }),
      "allow"
    );
    assert.equal(
      resolvePurchasingPageAccess({
        hasUser: true,
        profile: production,
        profileError: false,
        canIssuePurchaseOrders: false,
      }),
      "/staff"
    );
  });

  it("keeps sales, accounts, and customers on their own home", () => {
    for (const userRole of ["sales", "accounts", "customer"]) {
      assert.equal(
        resolvePurchasingPageAccess({
          hasUser: true,
          profile: { account_status: "approved", user_role: userRole },
          profileError: false,
          canIssuePurchaseOrders: true,
        }),
        userRole === "customer" ? "/dashboard" : "/staff"
      );
    }
  });

  it("fails closed when the permission check is unavailable", () => {
    assert.equal(
      resolvePurchasingPageAccess({
        hasUser: true,
        profile: approvedAdmin,
        profileError: false,
        canIssuePurchaseOrders: false,
      }),
      "/admin"
    );
  });
});

describe("purchase order list mapping", () => {
  it("shows a draft number, snapshot supplier, and draft total", () => {
    const item = toPurchaseOrderListItem({
      id: "order-1",
      po_number: null,
      status: "draft",
      created_at: "2026-10-25T12:00:00.000Z",
      suppliers: { name: "Live supplier" },
      issued_revision: null,
      draft_revision: {
        supplier_name: "Snapshot supplier",
        total_inc_vat: "18.50",
        issued_at: null,
      },
    });

    assert.equal(item.reference, "Draft");
    assert.equal(item.supplierName, "Snapshot supplier");
    assert.equal(item.statusLabel, "Draft");
    assert.equal(item.totalIncVat, 18.5);
    assert.equal(item.issuedAt, null);
    assert.equal(
      formatPurchaseOrderDate(item.createdAt),
      "25 Oct 2026"
    );
  });

  it("prefers the issued revision for totals and the issued date", () => {
    const item = toPurchaseOrderListItem({
      id: "order-2",
      po_number: "PO-1001",
      status: "partially_received",
      created_at: "2026-10-20T12:00:00.000Z",
      suppliers: null,
      issued_revision: {
        supplier_name: "Issued supplier",
        total_inc_vat: 120,
        issued_at: "2026-10-21T12:00:00.000Z",
      },
      draft_revision: {
        supplier_name: "Draft supplier",
        total_inc_vat: 10,
        issued_at: null,
      },
    });

    assert.deepEqual(pickDisplay(item), {
      reference: "PO-1001",
      supplierName: "Issued supplier",
      statusLabel: "Partially received",
      badgeStatus: "pending",
      totalIncVat: 120,
      issuedAt: "21 Oct 2026",
    });
  });
});

describe("purchasing navigation", () => {
  it("shows purchasing only through the authorised navigation flag", async () => {
    const source = await readFile(
      new URL("../../components/app-shell.tsx", import.meta.url),
      "utf8"
    );
    const customerLinks = source.slice(
      source.indexOf("const customerLinks"),
      source.indexOf("const adminLinks")
    );
    const adminLinks = source.slice(
      source.indexOf("const adminLinks"),
      source.indexOf("const crmLinks")
    );
    const staffBranch = source.slice(
      source.indexOf('userRole === "staff"'),
      source.indexOf(": customerLinks")
    );

    assert.match(source, /href: "\/purchasing"/);
    assert.match(source, /showPurchasingNav \? \[purchasingLink\] : \[\]/);
    assert.doesNotMatch(customerLinks, /\/purchasing/);
    assert.doesNotMatch(adminLinks, /\/purchasing/);
    assert.match(staffBranch, /showPurchasingNav/);
    assert.doesNotMatch(staffBranch, /adminLinks/);
  });

  it("gates the dashboard with the purchasing permission, not the admin page gate", async () => {
    const source = await readFile(
      new URL("../../app/purchasing/page.tsx", import.meta.url),
      "utf8"
    );

    assert.match(source, /requirePurchasingPageAccess/);
    assert.match(source, /href=\{PURCHASING_NEW_PATH\}/);
    assert.doesNotMatch(source, /requireAdminPageAccess/);
    assert.doesNotMatch(source, /createAdminClient/);
  });
});

describe("draft purchase orders", () => {
  const supplierId = "11111111-1111-4111-8111-111111111111";
  const orderId = "22222222-2222-4222-8222-222222222222";

  it("filters suppliers by name", () => {
    const suppliers = [
      { id: supplierId, name: "Antalis" },
      { id: orderId, name: "Pyramid Display" },
    ];

    assert.deepEqual(
      filterPurchasingSuppliers(suppliers, "  pyramid ").map(
        (supplier) => supplier.name
      ),
      ["Pyramid Display"]
    );
  });

  it("reads the new purchase order id and rejects a second immediate draft", () => {
    assert.equal(
      purchaseOrderIdFromCreateResult({ purchaseOrderId: orderId }),
      orderId
    );
    assert.equal(purchaseOrderIdFromCreateResult({ status: "draft" }), null);
    assert.equal(
      recentDuplicateDraftId(
        [{ id: orderId, createdAt: "2026-10-25T12:00:02.000Z" }],
        Date.parse("2026-10-25T12:00:04.000Z")
      ),
      orderId
    );
    assert.equal(
      recentDuplicateDraftId(
        [{ id: orderId, createdAt: "2026-10-25T12:00:00.000Z" }],
        Date.parse("2026-10-25T12:00:06.000Z")
      ),
      null
    );
  });

  it("maps a new draft for the detail page", () => {
    const detail = toPurchaseOrderDetail({
      id: orderId,
      po_number: null,
      status: "draft",
      created_at: "2026-10-25T12:00:00.000Z",
      issued_revision: null,
      draft_revision: {
        id: supplierId,
        supplier_name: "Antalis",
        supplier_orders_email: "orders@antalis.example",
        currency: "GBP",
        vat_treatment: "standard",
        delivery_method: "workshop",
        delivery_country: "United Kingdom",
        total_inc_vat: "0.00",
        revision_number: 1,
        issued_at: null,
        purchase_order_lines: [],
      },
    });

    assert.equal(detail.reference, "Draft");
    assert.equal(detail.supplierName, "Antalis");
    assert.equal(detail.ordersEmail, "orders@antalis.example");
    assert.equal(detail.statusLabel, "Draft");
    assert.equal(detail.vatTreatmentLabel, "Standard");
    assert.equal(detail.deliveryLabel, "Workshop, United Kingdom");
    assert.equal(detail.totalIncVat, 0);
    assert.equal(detail.lineCount, 0);
    assert.equal(detail.issuedAt, null);
  });

  it("keeps creation errors generic", () => {
    assert.equal(
      createDraftErrorCode({ message: "Supplier is not active" }),
      "inactive"
    );
    assert.equal(createDraftErrorCode({ code: "42501", message: "" }), "forbidden");
    assert.equal(
      createDraftErrorMessage("failed"),
      "The draft could not be created."
    );
    assert.equal(createDraftErrorMessage("database relation missing"), null);
  });

  it("logs only the database error fields from a failed create", () => {
    assert.deepEqual(
      purchaseOrderCreateErrorLog({
        code: "42501",
        message: "permission denied for function purchase_order_require_purchaser",
        details: "Not authorized.",
        hint: "Check the function owner.",
        access_token: "secret-token",
        cookie: "sb-access-token=secret",
        authorization: "Bearer secret",
      } as {
        code: string;
        message: string;
        details: string;
        hint: string;
      }),
      {
        code: "42501",
        message: "permission denied for function purchase_order_require_purchaser",
        details: "Not authorized.",
        hint: "Check the function owner.",
      }
    );
    assert.deepEqual(purchaseOrderCreateErrorLog(null), {
      code: null,
      message: null,
      details: null,
      hint: null,
    });
  });

  it("checks purchasing permission before creating or opening an order", async () => {
    const [action, supplierPage, detailPage, list] = await Promise.all([
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../../app/purchasing/new/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../app/purchasing/[id]/page.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../../components/purchasing/purchase-order-list.tsx", import.meta.url),
        "utf8"
      ),
    ]);

    for (const source of [action, supplierPage, detailPage]) {
      assert.match(source, /requirePurchasingPageAccess/);
      assert.doesNotMatch(source, /createAdminClient/);
      assert.doesNotMatch(source, /requireAdminPageAccess/);
    }

    assert.match(action, /create_purchase_order/);
    assert.match(action, /p_supplier_id: supplierId/);
    assert.match(
      action,
      /console\.error\(\s*"create_purchase_order failed",\s*purchaseOrderCreateErrorLog\(error\),?\s*\)/
    );
    assert.match(action, /error=\$\{createDraftErrorCode\(error\)\}/);
    assert.doesNotMatch(action, /console\.error\([^)]*formData/);
    assert.doesNotMatch(action, /console\.error\(\s*error\s*\)/);
    assert.match(list, /href=\{purchaseOrderHref\(order\.id\)\}/);
    assert.match(list, /recorded on this revision/);
    assert.match(action, /save_purchase_order_draft/);
    assert.match(action, /loadSavedDraftLines/);
    assert.match(action, /issue_purchase_order/);
    assert.doesNotMatch(action, /enqueue_purchase_order_email/);
    assert.doesNotMatch(action, /PO-\$\{/);
    assert.doesNotMatch(action, /po_number\s*=/);
  });

  it("keeps issuing separate from supplier email and stores the issued PDF", async () => {
    const [sql, file, route, editor, issuePage] = await Promise.all([
      readFile(
        new URL("../../supabase/migrations/20261024120000_purchase_orders.sql", import.meta.url),
        "utf8"
      ),
      readFile(new URL("./purchase-order-file.ts", import.meta.url), "utf8"),
      readFile(new URL("../../app/api/purchasing/[id]/pdf/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../../components/purchasing/draft-editor.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../app/purchasing/[id]/issue/page.tsx", import.meta.url), "utf8"),
    ]);
    const issueStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.issue_purchase_order");
    const issueEnd = sql.indexOf("CREATE OR REPLACE FUNCTION public.open_purchase_order_revision");
    const issueSql = sql.slice(issueStart, issueEnd);

    assert.equal(issueSql.includes("enqueue_purchase_order_email"), false);
    assert.match(issueSql, /purchase_order_counters/);
    assert.match(issueSql, /PO-' \|\| v_number/);
    assert.match(file, /assert_can_store_purchase_order_pdf/);
    assert.match(file, /attach_purchase_order_pdf/);
    assert.match(file, /commitPurchaseOrderPdf/);
    assert.match(file, /upsert:\s*false/);
    assert.doesNotMatch(file, /upsert:\s*true/);
    assert.match(file, /purchase-order-files/);
    assert.doesNotMatch(file, /enqueue_purchase_order_email/);
    assert.match(route, /requirePurchasingPageAccess/);
    assert.doesNotMatch(route, /createAdminClient/);
    assert.match(editor, /Quantity allocated/);
    assert.match(issuePage, /does not/);
    assert.match(issuePage, /email the supplier/);
    assert.doesNotMatch(issuePage, /enqueue_purchase_order_email/);
  });

  it("blocks issue until the saved draft meets the database rules", () => {
    const draft = sampleDraft();
    assert.match(validateIssueReady(draft) ?? "", /Line 2 is not fully allocated/);
    draft.lines[1]?.allocations.push({
      key: "stock-2",
      target: "stock",
      jobId: "",
      quantity: "1",
    });
    assert.equal(validateIssueReady(draft), null);
    draft.supplierOrdersEmail = "";
    assert.match(validateIssueReady(draft) ?? "", /supplier email/i);
    assert.equal(
      issueErrorMessage({ message: "A supplier email is required before issuing" }),
      "A supplier email is required before issuing."
    );
    assert.equal(
      issueErrorMessage({ code: "42501", message: "permission denied for function enqueue" }),
      "You do not have permission to issue this purchase order."
    );
  });

  it("prints the issued revision snapshot and does not invent a PO number", async () => {
    assert.equal(purchaseOrderPdfFilename("PO-1001"), "PO-1001.pdf");
    assert.equal(purchaseOrderPdfFilename("Draft"), "purchase-order.pdf");
    const bytes = await renderPurchaseOrderPdf({
      poNumber: "PO-1001",
      revisionNumber: 1,
      supplierName: "All Print Supplies",
      supplierOrdersEmail: "orders@example.test",
      issuedAt: "2026-10-25T12:00:00.000Z",
      deliveryRecipient: "Candid Creative Limited",
      deliveryLine1: "Innovation House",
      deliveryLine2: "Cray Road, Sidcup",
      deliveryCity: null,
      deliveryCounty: null,
      deliveryPostcode: "DA14 5DP",
      deliveryCountry: "United Kingdom",
      deliveryInstructions: "Leave at reception",
      deliveryDate: "2026-10-28",
      deliveryChargeExVat: 5,
      goodsExVat: 100,
      subtotalExVat: 105,
      vatRate: 0.2,
      vatTotal: 21,
      totalIncVat: 126,
      lines: [
        {
          description: "Foam board",
          supplierSku: "FB-1",
          unit: "sheet",
          quantity: 2,
          unitPriceExVat: 50,
          lineTotalExVat: 100,
        },
      ],
    });
    const text = bytes
      .toString("latin1")
      .replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, "hex").toString("latin1"))
      .replace(/\[([^\[\]]*)\]\s*TJ/g, (_match, inner: string) =>
        inner.replace(/\s+-?\d+(?:\.\d+)?\s*/g, "")
      );
    assert.match(text, /%PDF/);
    assert.match(text, /Candid Creative Limited/);
    assert.match(text, /PO-1001/);
    assert.match(text, /All Print Supplies/);
    assert.match(text, /orders@example\.test/);
    assert.match(text, /Foam board/);
    assert.match(text, /Leave at reception/);
    assert.doesNotMatch(text, /LIVE-CATALOGUE-PRICE/);
  });

  it("sends every draft field and replaces saved line ids", () => {
    const draft = sampleDraft();
    assert.equal(validateDraft(draft), null);
    const payload = buildPurchaseOrderDraftPayload(draft);
    const names = payloadFieldNames(payload);
    assert.deepEqual(names.root, names.required);
    assert.deepEqual(payload.deliveryAllocations, []);
    assert.equal(payload.lines[0]?.materialId, null);
    assert.equal(payload.lines[1]?.priceId, "00000000-0000-4000-8000-000000000031");
    assert.deepEqual(Object.keys(payload.lines[0] ?? {}).sort(), [
      "allocations",
      "description",
      "lineKind",
      "materialId",
      "priceId",
      "productId",
      "quantity",
      "supplierSku",
      "unit",
      "unitPriceExVat",
      "vatTreatment",
    ]);
    assert.equal("key" in (payload.lines[0] ?? {}), false);

    const saved = applySavedDraft(draft, {
      supplierOrdersEmail: "orders@supplier.test",
      lines: [
        {
          ...draft.lines[0],
          key: "temporary",
          lineId: "00000000-0000-4000-8000-000000000099",
        },
      ],
      deliveryAllocations: [],
    });
    assert.equal(saved.lines[0]?.key, "00000000-0000-4000-8000-000000000099");
    assert.equal(saved.lines[0]?.lineId, "00000000-0000-4000-8000-000000000099");
    assert.equal(
      saveDraftErrorMessage({
        code: "42501",
        message: "permission denied for function purchase_order_assert_pointers",
      }),
      "The draft could not be saved."
    );
    assert.match(
      saveDraftErrorMessage({ message: "Line 1 quantity must be greater than zero" }),
      /quantity must be greater than zero/
    );
  });
});

function sampleDraft(): EditorDraft {
  const manual = emptyManualLine("manual");
  manual.description = "Foam offcut";
  manual.unit = "sheet";
  manual.quantity = "2";
  manual.unitPriceExVat = "3.50";
  manual.allocations = [
    { key: "stock", target: "stock", jobId: "", quantity: "2" },
  ];
  const catalogue = emptyCatalogueLine("catalogue");
  catalogue.materialId = "00000000-0000-4000-8000-000000000021";
  catalogue.productId = "00000000-0000-4000-8000-000000000031";
  catalogue.priceId = "00000000-0000-4000-8000-000000000031";
  catalogue.description = "Foam board";
  catalogue.unit = "sheet";
  catalogue.quantity = "1";
  catalogue.unitPriceExVat = "4.25";

  return {
    supplierOrdersEmail: "Orders@Supplier.test",
    vatTreatment: "standard",
    deliveryMethod: "workshop",
    deliveryRecipient: "",
    deliveryLine1: "",
    deliveryLine2: "",
    deliveryCity: "",
    deliveryCounty: "",
    deliveryPostcode: "",
    deliveryCountry: "United Kingdom",
    deliveryInstructions: "",
    deliveryDate: "",
    deliveryChargeExVat: "0",
    deliveryChargeMethod: "proportional",
    lines: [manual, catalogue],
    deliveryAllocations: [],
    vatRate: 0.2,
  };
}

function pickDisplay(item: PurchaseOrderListItem) {
  return {
    reference: item.reference,
    supplierName: item.supplierName,
    statusLabel: item.statusLabel,
    badgeStatus: item.badgeStatus,
    totalIncVat: item.totalIncVat,
    issuedAt: formatPurchaseOrderDate(item.issuedAt),
  };
}
