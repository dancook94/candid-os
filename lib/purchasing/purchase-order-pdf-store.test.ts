import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { purchaseOrderPdfSha256 } from "@/lib/purchasing/purchase-order-pdf";
import {
  commitPurchaseOrderPdf,
  officialPurchaseOrderPdfPath,
  purchaseOrderPdfAction,
  purchaseOrderPdfAttachment,
  type PurchaseOrderPdfUploadResult,
} from "@/lib/purchasing/purchase-order-pdf-store";

const orderId = "3c706c4b-c482-4d67-99f3-9ac9a9e7ba63";
const revisionId = "11111111-1111-4111-8111-111111111111";
const otherOrderId = "22222222-2222-4222-8222-222222222222";
const otherRevisionId = "33333333-3333-4333-8333-333333333333";

describe("purchase order PDF storage", () => {
  it("rejects a stored path that belongs to another order or revision", () => {
    const expected = officialPurchaseOrderPdfPath(orderId, revisionId);
    assert.equal(purchaseOrderPdfAction(null, expected), "create");
    assert.equal(purchaseOrderPdfAction(expected, expected), "download");
    assert.equal(
      purchaseOrderPdfAction(officialPurchaseOrderPdfPath(otherOrderId, revisionId), expected),
      "reject"
    );
    assert.equal(
      purchaseOrderPdfAction(officialPurchaseOrderPdfPath(orderId, otherRevisionId), expected),
      "reject"
    );
    assert.notEqual(
      officialPurchaseOrderPdfPath(orderId, revisionId),
      officialPurchaseOrderPdfPath(otherOrderId, otherRevisionId)
    );
  });

  it("attaches the stored object when another upload already won", async () => {
    const bucket = memoryBucket();
    bucket.object = Buffer.from("%PDF official");
    const rendered = Buffer.from("%PDF rendered differently");
    let attached: Buffer | null = null;

    const result = await commitPurchaseOrderPdf({
      rendered,
      upload: async () => ({ status: "exists" }),
      downloadExisting: async () => ({ ok: true, bytes: Buffer.from(bucket.object!) }),
      attach: async (bytes) => {
        attached = Buffer.from(bytes);
        return { ok: true };
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bytes.equals(bucket.object), true);
      assert.equal(result.bytes.equals(rendered), false);
    }
    assert.equal(attached?.equals(bucket.object), true);
    assert.deepEqual(purchaseOrderPdfAttachment(bucket.object), {
      sha256: purchaseOrderPdfSha256(bucket.object),
      byteSize: bucket.object.length,
    });
  });

  it("returns one official file when two different renders race", async () => {
    const bucket = racingBucket();
    const first = Buffer.from("%PDF first render");
    const second = Buffer.from("%PDF second render with more bytes");
    const [left, right] = await Promise.all([
      commitPurchaseOrderPdf({ rendered: first, ...bucket.handlers }),
      commitPurchaseOrderPdf({ rendered: second, ...bucket.handlers }),
    ]);

    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    if (!left.ok || !right.ok) {
      return;
    }
    const official = bucket.object();
    assert.ok(official);
    assert.equal(left.bytes.equals(official), true);
    assert.equal(right.bytes.equals(official), true);
    assert.equal(left.bytes.equals(right.bytes), true);
    for (const attached of bucket.attached()) {
      assert.equal(attached.equals(official), true);
      assert.equal(purchaseOrderPdfSha256(attached), purchaseOrderPdfSha256(official));
    }
    assert.equal(bucket.record()?.hash, purchaseOrderPdfSha256(official));
    assert.equal(bucket.record()?.size, official.length);
  });

  it("does not attach or claim success when the upload fails", async () => {
    let attached = false;
    const result = await commitPurchaseOrderPdf({
      rendered: Buffer.from("%PDF new"),
      upload: async () => ({ status: "failed", message: "storage unavailable" }),
      downloadExisting: async () => {
        throw new Error("stored PDF should not be read after a failed upload");
      },
      attach: async () => {
        attached = true;
        return { ok: true };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(attached, false);
    if (!result.ok) {
      assert.equal(result.alreadyRecorded, false);
      assert.match(result.message, /could not be stored/);
      assert.doesNotMatch(result.message, /saved/i);
    }
  });

  it("does not attach a new render when the existing object cannot be read", async () => {
    let attached = false;
    const result = await commitPurchaseOrderPdf({
      rendered: Buffer.from("%PDF new"),
      upload: async () => ({ status: "exists" }),
      downloadExisting: async () => ({ ok: false, message: "missing" }),
      attach: async () => {
        attached = true;
        return { ok: true };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(attached, false);
    if (!result.ok) {
      assert.match(result.message, /could not be stored/);
    }
  });

  it("retries against the stored object after an attachment failure", async () => {
    const official = Buffer.from("%PDF stored once");
    let object: Buffer | null = null;
    let failAttach = true;
    let recorded: Buffer | null = null;

    const handlers = {
      upload: async (bytes: Buffer): Promise<PurchaseOrderPdfUploadResult> => {
        if (object) {
          return { status: "exists" };
        }
        object = Buffer.from(bytes);
        return { status: "uploaded" };
      },
      downloadExisting: async () =>
        object
          ? { ok: true as const, bytes: Buffer.from(object) }
          : { ok: false as const, message: "missing" },
      attach: async (bytes: Buffer) => {
        if (failAttach) {
          failAttach = false;
          return { ok: false as const, alreadyRecorded: false, message: "temporary failure" };
        }
        recorded = Buffer.from(bytes);
        return { ok: true as const };
      },
    };

    const first = await commitPurchaseOrderPdf({
      rendered: official,
      ...handlers,
    });
    const second = await commitPurchaseOrderPdf({
      rendered: Buffer.from("%PDF a later different render"),
      ...handlers,
    });

    assert.equal(first.ok, false);
    if (!first.ok) {
      assert.equal(first.alreadyRecorded, false);
      assert.match(first.message, /could not be stored/);
    }
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.bytes.equals(official), true);
    }
    assert.equal(recorded?.equals(official), true);
    assert.equal(object?.equals(official), true);
  });

  it("reports an attachment conflict without treating the new render as saved", async () => {
    const result = await commitPurchaseOrderPdf({
      rendered: Buffer.from("%PDF new"),
      upload: async () => ({ status: "exists" }),
      downloadExisting: async () => ({ ok: true, bytes: Buffer.from("%PDF official") }),
      attach: async () => ({
        ok: false,
        alreadyRecorded: true,
        message: "A different purchase order PDF is already stored",
      }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.alreadyRecorded, true);
      assert.match(result.message, /could not be stored/);
      assert.doesNotMatch(result.message, /saved/i);
    }
  });

  it("keeps the service role on the server and the PDF route on the requested order", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const [file, route, admin, clientSources] = await Promise.all([
      readFile(path.join(root, "lib/purchasing/purchase-order-file.ts"), "utf8"),
      readFile(path.join(root, "app/api/purchasing/[id]/pdf/route.ts"), "utf8"),
      readFile(path.join(root, "lib/supabase/admin.ts"), "utf8"),
      readClientSources(root),
    ]);

    assert.match(file, /commitPurchaseOrderPdf/);
    assert.match(file, /upsert:\s*false/);
    assert.doesNotMatch(file, /upsert:\s*true/);
    assert.match(file, /purchaseOrderPdfAttachment\(official\)/);
    assert.match(file, /current_issued_revision/);
    assert.match(file, /revision\.purchase_order_id !== orderId/);
    assert.doesNotMatch(file, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(file, /enqueue_purchase_order_email/);
    assert.match(route, /requirePurchasingPageAccess/);
    assert.match(route, /loadPurchaseOrderPdf\(supabase, id\)/);
    assert.doesNotMatch(route, /searchParams/);
    assert.doesNotMatch(route, /createAdminClient/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(admin, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
    for (const source of clientSources) {
      assert.doesNotMatch(source, /createAdminClient/);
      assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.doesNotMatch(source, /purchase-order-file/);
    }
  });
});

function memoryBucket() {
  return { object: null as Buffer | null };
}

function racingBucket() {
  let object: Buffer | null = null;
  let writing = false;
  const attached: Buffer[] = [];
  let record: { hash: string; size: number } | null = null;

  return {
    object: () => object,
    attached: () => attached,
    record: () => record,
    handlers: {
      upload: async (bytes: Buffer): Promise<PurchaseOrderPdfUploadResult> => {
        if (object) {
          return { status: "exists" };
        }
        if (writing) {
          await delay(5);
          return object
            ? { status: "exists" }
            : { status: "failed", message: "upload conflict" };
        }
        writing = true;
        await delay(5);
        object = Buffer.from(bytes);
        writing = false;
        return { status: "uploaded" };
      },
      downloadExisting: async () =>
        object
          ? { ok: true as const, bytes: Buffer.from(object) }
          : { ok: false as const, message: "missing" },
      attach: async (bytes: Buffer) => {
        const attachment = purchaseOrderPdfAttachment(bytes);
        if (
          record &&
          (record.hash !== attachment.sha256 || record.size !== attachment.byteSize)
        ) {
          return {
            ok: false as const,
            alreadyRecorded: true,
            message: "A different purchase order PDF is already stored",
          };
        }
        record = { hash: attachment.sha256, size: attachment.byteSize };
        attached.push(Buffer.from(bytes));
        return { ok: true as const };
      },
    },
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readClientSources(root: string) {
  const directories = [
    path.join(root, "components/purchasing"),
    path.join(root, "app/purchasing"),
  ];
  const files: string[] = [];
  for (const directory of directories) {
    await collect(directory, files);
  }
  const sources = await Promise.all(
    files
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFile(file, "utf8"))
  );
  return sources.filter((source) => source.includes("use client"));
}

async function collect(directory: string, files: string[]) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
}
