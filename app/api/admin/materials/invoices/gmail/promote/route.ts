import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { bulkCounts, emptyBulkReport, nextBulkBatch } from "@/lib/materials/invoices/gmail-bulk";
import {
  loadGmailPromotionPreview,
  promoteGmailInvoiceBatch,
  requireGmailPromotionAccess,
} from "@/lib/materials/invoices/gmail-promotion";
import {
  INVOICE_PROCESSING_DEFAULT_BATCH_SIZE,
  INVOICE_PROCESSING_MIGRATION_MESSAGE,
  resolveProcessingLimit,
  selectProcessingScope,
} from "@/lib/materials/invoices/processing-run";
import {
  loadInvoiceProcessingView,
  pauseInvoiceProcessingRun,
  resumeInvoiceProcessingRun,
  retryFailedProcessingAttempts,
  startInvoiceProcessingRun,
} from "@/lib/materials/invoices/processing-store";
import { advanceStoredInvoiceProcessing } from "@/lib/materials/invoices/processing-tick";
import { loadInvoiceMatchCatalog } from "@/lib/materials/invoices/queries";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const access = await requireGmailPromotionAccess(supabase);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = (await request.json()) as {
    action?: string;
    command?: string;
    mode?: string;
    itemIds?: string[];
    batchSize?: number;
    invoiceLimit?: number | string;
    skipItemIds?: string[];
  };

  try {
    if (body.action === "preview") {
      return NextResponse.json(await loadGmailPromotionPreview(supabase));
    }

    if (body.action === "processing") {
      const view = await loadInvoiceProcessingView(supabase);

      if (!view.available) {
        return NextResponse.json({ error: INVOICE_PROCESSING_MIGRATION_MESSAGE }, { status: 400 });
      }

      const command = body.command ?? "tick";

      if (command === "start") {
        const creating = !view.run || view.run.status === "completed";
        let invoiceLimit = view.run?.invoiceLimit ?? INVOICE_PROCESSING_DEFAULT_BATCH_SIZE;
        let eligibleAtStart = view.run?.eligibleAtStart ?? 0;
        let scopeItemIds = view.run?.scopeItemIds ?? [];

        if (creating) {
          const preview = await loadGmailPromotionPreview(supabase);

          if (!preview.ok) {
            return NextResponse.json({ error: preview.error }, { status: 400 });
          }

          eligibleAtStart = preview.rows.filter((row) => row.selectable).length;

          if (eligibleAtStart === 0) {
            return NextResponse.json(
              { error: "There are no invoices eligible for automatic processing." },
              { status: 400 }
            );
          }

          invoiceLimit = resolveProcessingLimit({ requested: body.invoiceLimit, eligibleCount: eligibleAtStart });
          scopeItemIds = selectProcessingScope(preview.rows, invoiceLimit);
        }

        const started = await startInvoiceProcessingRun(supabase, {
          userId: access.userId,
          batchSize: body.batchSize ?? INVOICE_PROCESSING_DEFAULT_BATCH_SIZE,
          invoiceLimit,
          eligibleAtStart,
          scopeItemIds,
        });

        if (!started.available) {
          return NextResponse.json({ error: INVOICE_PROCESSING_MIGRATION_MESSAGE }, { status: 400 });
        }
      } else if (command === "pause") {
        if (view.run && view.run.status === "running") {
          await pauseInvoiceProcessingRun(supabase, view.run.id);
        }
      } else if (command === "resume") {
        if (view.run && view.run.status === "paused") {
          await resumeInvoiceProcessingRun(supabase, view.run.id);
        }
      } else if (command === "retry") {
        if (view.run) {
          await retryFailedProcessingAttempts(supabase, view.run.id);
        }
      } else if (command !== "tick") {
        return NextResponse.json({ error: "Unknown processing action." }, { status: 400 });
      }

      const processing =
        command === "pause" ? { status: "paused" as const } : await advanceStoredInvoiceProcessing(supabase, access.userId);
      revalidatePath("/admin/materials/invoices");
      revalidatePath("/admin/materials/invoices/gmail");
      revalidatePath("/admin/materials/invoices/exceptions");
      return NextResponse.json({ processing });
    }

    if (body.action === "bulk") {
      const preview = await loadGmailPromotionPreview(supabase);

      if (!preview.ok) {
        return NextResponse.json({ error: preview.error }, { status: 400 });
      }

      const requested = (body.itemIds ?? []).map((itemId) => itemId.trim()).filter(Boolean);
      const selectable = new Set(preview.rows.filter((row) => row.selectable).map((row) => row.itemId));
      const planned =
        requested.length > 0
          ? requested.filter((itemId) => selectable.has(itemId))
          : nextBulkBatch(preview.rows, body.batchSize ?? 5, body.skipItemIds ?? []);
      const itemIds = planned.slice(0, 10);

      if (itemIds.length === 0) {
        return NextResponse.json({ report: emptyBulkReport(), pending: 0, counts: bulkCounts(preview.rows) });
      }

      const catalog = await loadInvoiceMatchCatalog(supabase);

      if (!catalog.ok) {
        return NextResponse.json({ error: catalog.error }, { status: 400 });
      }

      const report = await promoteGmailInvoiceBatch({
        supabase,
        userId: access.userId,
        itemIds,
        catalog,
      });
      const after = await loadGmailPromotionPreview(supabase);
      const held = new Set([
        ...(body.skipItemIds ?? []),
        ...report.results
          .filter((result) => result.outcome === "failed" || result.outcome === "skipped")
          .map((result) => result.itemId),
      ]);
      const pending = after.ok
        ? after.rows.filter((row) => row.selectable && !held.has(row.itemId)).length
        : 0;
      revalidatePath("/admin/materials/invoices");
      revalidatePath("/admin/materials/invoices/gmail");
      revalidatePath("/admin/materials/invoices/exceptions");

      for (const result of report.results) {
        if (result.invoiceId) {
          revalidatePath(`/admin/materials/invoices/${result.invoiceId}`);
        }
      }

      return NextResponse.json({
        report,
        pending,
        counts: bulkCounts(after.ok ? after.rows : preview.rows),
      });
    }

    if (body.action !== "promote") {
      return NextResponse.json({ error: "Unknown promotion action." }, { status: 400 });
    }

    const manual = body.mode === "manual";
    const preview = await loadGmailPromotionPreview(supabase);

    if (!preview.ok) {
      return NextResponse.json({ error: preview.error }, { status: 400 });
    }

    const allowed = new Set(
      preview.rows
        .filter((row) => (manual ? row.queue === "manual" : row.selectable))
        .map((row) => row.itemId)
    );
    const itemIds = (body.itemIds ?? []).map((itemId) => itemId.trim()).filter((itemId) => allowed.has(itemId));

    if (itemIds.length === 0) {
      return NextResponse.json(
        { error: manual ? "Choose a document that needs manual classification." : "Choose an invoice eligible for automatic processing." },
        { status: 400 }
      );
    }

    const catalog = await loadInvoiceMatchCatalog(supabase);

    if (!catalog.ok) {
      return NextResponse.json({ error: catalog.error }, { status: 400 });
    }

    const report = await promoteGmailInvoiceBatch({
      supabase,
      userId: access.userId,
      itemIds,
      catalog,
      mode: manual ? "manual" : "automatic",
    });
    revalidatePath("/admin/materials/invoices");
    revalidatePath("/admin/materials/invoices/gmail");

    for (const result of report.results) {
      if (result.invoiceId) {
        revalidatePath(`/admin/materials/invoices/${result.invoiceId}`);
      }
    }

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The invoices could not be promoted." },
      { status: 400 }
    );
  }
}
