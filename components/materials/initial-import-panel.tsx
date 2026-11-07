"use client";

import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  APPROVED_IMPORT_CATALOG_VERSIONS,
  batchImportLabel,
  buildImportPlanSummary,
  type ApprovedImportCatalogVersion,
} from "@/lib/materials/import-batches";
import { INITIAL_IMPORT_CONFIRMATION } from "@/lib/materials/initial-import-catalog";
import { MEDIUM_IMPORT_CATALOG_VERSION } from "@/lib/materials/medium-import-catalog";
import type { InitialImportPlan } from "@/lib/materials/initial-import-plan";

function formatOpeningPrice(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value);
}

type ImportBatchConfig = {
  catalogVersion: ApprovedImportCatalogVersion;
  materialNames: string[];
};

type ImportResult = {
  effectiveDate?: string;
  createdSuppliers?: string[];
  matchedSuppliers?: string[];
  createdAliases?: Array<{ canonicalName: string; alias: string }>;
  createdMaterials?: string[];
  createdPrices?: Array<{ name: string; price: number; priceUnit: string }>;
};

function actionStatus(action: string) {
  if (action === "create") {
    return { status: "pending" as const, label: "Will create" };
  }

  if (action === "match" || action === "already_matched") {
    return { status: "approved" as const, label: "Matched" };
  }

  if (action === "extend") {
    return { status: "pending" as const, label: "Will add supplier" };
  }

  if (action === "deferred") {
    return { status: "draft" as const, label: "Not in this import" };
  }

  return { status: "declined" as const, label: "Blocked" };
}

export function InitialImportPanel({ batches }: { batches: ImportBatchConfig[] }) {
  const defaultVersion =
    batches[0]?.catalogVersion ?? APPROVED_IMPORT_CATALOG_VERSIONS[0];
  const [catalogVersion, setCatalogVersion] =
    useState<ApprovedImportCatalogVersion>(defaultVersion);
  const [plans, setPlans] = useState<
    Partial<Record<ApprovedImportCatalogVersion, InitialImportPlan>>
  >({});
  const [results, setResults] = useState<
    Partial<Record<ApprovedImportCatalogVersion, ImportResult>>
  >({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"preview" | "commit" | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const activeBatch = useMemo(
    () => batches.find((batch) => batch.catalogVersion === catalogVersion),
    [batches, catalogVersion]
  );
  const plan = plans[catalogVersion] ?? null;
  const result = results[catalogVersion] ?? null;
  const summarySections = plan ? buildImportPlanSummary(plan) : [];

  function switchBatch(next: ApprovedImportCatalogVersion) {
    setCatalogVersion(next);
    setError("");
    setConfirmed(false);
  }

  async function run(mode: "preview" | "commit") {
    setPending(mode);
    setError("");

    if (mode === "preview") {
      setResults((existing) => ({ ...existing, [catalogVersion]: undefined }));
      setConfirmed(false);
    }

    try {
      const response = await fetch("/api/admin/materials/initial-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "commit"
            ? {
                mode: "commit",
                catalogVersion,
                confirmation: INITIAL_IMPORT_CONFIRMATION,
              }
            : { mode: "preview", catalogVersion }
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        plan?: InitialImportPlan;
        result?: ImportResult;
      };

      if (payload.plan) {
        setPlans((existing) => ({
          ...existing,
          [catalogVersion]: payload.plan ?? undefined,
        }));
      }

      if (!response.ok) {
        setError(payload.error ?? "The dry import could not be completed.");
        if (mode === "commit") {
          setResults((existing) => ({ ...existing, [catalogVersion]: undefined }));
        }
        return;
      }

      if (mode === "commit") {
        setResults((existing) => ({
          ...existing,
          [catalogVersion]: payload.result ?? {},
        }));
        setConfirmed(false);
      }
    } catch {
      setError("The dry import could not be completed.");
    } finally {
      setPending(null);
    }
  }

  const importAliases = plan?.aliases.filter((alias) => alias.action !== "deferred") ?? [];
  const deferredAliases = plan?.aliases.filter((alias) => alias.action === "deferred") ?? [];

  return (
    <div className="space-y-6">
      <Card className="portal-surface">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="import-batch">Approved catalogue batch</Label>
            <select
              id="import-batch"
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full max-w-xl rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              value={catalogVersion}
              onChange={(event) =>
                switchBatch(event.target.value as ApprovedImportCatalogVersion)
              }
            >
              {APPROVED_IMPORT_CATALOG_VERSIONS.map((version) => (
                <option key={version} value={version}>
                  {batchImportLabel(version)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted-foreground">
            Dry import reads the live database and builds a plan only. It does not
            call <code className="text-xs">apply_initial_materials_import</code> or
            write suppliers, materials, aliases, or prices.
          </p>
          {catalogVersion === MEDIUM_IMPORT_CATALOG_VERSION ? (
            <p className="text-sm text-amber-950">
              Batch 2 can be previewed any time. Commit stays blocked until batch 1
              is recorded in <code className="text-xs">material_import_runs</code>.
            </p>
          ) : null}
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(activeBatch?.materialNames ?? []).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={pending != null}
            onClick={() => run("preview")}
          >
            {pending === "preview"
              ? `Running ${batchImportLabel(catalogVersion)} dry import…`
              : `Run dry import for ${batchImportLabel(catalogVersion)}`}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Card className="rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
          <CardContent className="p-6 text-sm text-red-950">{error}</CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50 shadow-sm ring-0">
          <CardContent className="space-y-2 p-6 text-sm text-emerald-950">
            <p className="font-medium">
              {batchImportLabel(catalogVersion)} saved. Opening prices are effective{" "}
              {result.effectiveDate}.
            </p>
            <p>
              Created {(result.createdMaterials ?? []).length} materials,{" "}
              {(result.createdSuppliers ?? []).join(", ") || "no new suppliers"}, and{" "}
              {(result.createdAliases ?? []).length} aliases.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {plan ? (
        <>
          <Card className="portal-surface">
            <CardContent className="space-y-3 p-6 text-sm">
              <p>
                Catalog <span className="font-medium">{plan.catalogVersion}</span>.
                A confirmed import would use effective date {plan.effectiveDate}. £/m²
                and £/L are calculated for review, not stored on this page.
              </p>
              {plan.importStatus ? (
                <p>
                  Batch 1 recorded:{" "}
                  {plan.importStatus.batch1Completed ? "yes" : "no"}.
                  {plan.importStatus.completedCatalogVersions.length > 0
                    ? ` Completed imports: ${plan.importStatus.completedCatalogVersions.join(", ")}.`
                    : " No imports logged yet."}
                </p>
              ) : null}
              <p>
                {plan.counts.suppliersToCreate} suppliers to create,{" "}
                {plan.counts.suppliersMatched} matched. {plan.counts.aliasesToCreate}{" "}
                aliases to create, {plan.counts.aliasesMatched} matched.{" "}
                {plan.counts.materialsToCreate} materials,{" "}
                {plan.counts.productsToCreate} supplier products, and{" "}
                {plan.counts.pricesToCreate} opening prices to create.{" "}
                {plan.counts.alreadyMatched} already matched.{" "}
                {plan.counts.conflicts} blocked.
              </p>
              {plan.blockedReason ? (
                <p className="text-amber-900">{plan.blockedReason}</p>
              ) : (
                <p>Dry import is clear. Nothing has been written yet.</p>
              )}
              {plan.warnings.map((warning) => (
                <p key={warning} className="text-amber-900">
                  {warning}
                </p>
              ))}
              {plan.errors.map((item) => (
                <p key={item} className="text-red-800">
                  {item}
                </p>
              ))}
            </CardContent>
          </Card>

          {summarySections.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Conflict and match summary</h2>
              <div className="space-y-4">
                {summarySections.map((section) => (
                  <Card key={section.title} className="portal-surface">
                    <CardContent className="space-y-2 p-6 text-sm">
                      <h3 className="font-medium">{section.title}</h3>
                      <ul className="space-y-2">
                        {section.rows.map((row) => (
                          <li key={`${section.title}-${row.label}`}>
                            <span className="font-medium">{row.label}.</span>{" "}
                            {row.detail}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Suppliers</h2>
            <Card className="portal-surface overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Result</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.suppliers.map((supplier) => {
                        const badge = actionStatus(supplier.action);
                        return (
                          <tr key={supplier.name}>
                            <td className="px-4 py-3.5 font-medium">{supplier.name}</td>
                            <td className="px-4 py-3.5">
                              <StatusBadge status={badge.status} label={badge.label} />
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {supplier.note}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Supplier aliases</h2>
            <Card className="portal-surface overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Alias</th>
                        <th>Canonical supplier</th>
                        <th>Result</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importAliases.map((alias) => {
                        const badge = actionStatus(alias.action);
                        return (
                          <tr key={`${alias.canonicalName}-${alias.alias}`}>
                            <td className="px-4 py-3.5">{alias.alias}</td>
                            <td className="px-4 py-3.5">{alias.canonicalName}</td>
                            <td className="px-4 py-3.5">
                              <StatusBadge status={badge.status} label={badge.label} />
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {alias.note}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            {deferredAliases.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {deferredAliases.length} deferred alias rows are listed in the batch 1
                plan only.
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Materials, products, and prices</h2>
            <Card className="portal-surface overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Specification</th>
                        <th>Purchase format</th>
                        <th>Supplier</th>
                        <th>Opening price</th>
                        <th>£/m²</th>
                        <th>Result</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.materials.flatMap((material) =>
                        material.products.map((product) => {
                          const badge = actionStatus(product.action);
                          const derived =
                            product.costPerLitre != null
                              ? product.costPerLitreLabel
                              : product.costPerSquareMetreLabel;
                          return (
                            <tr key={product.key}>
                              <td className="px-4 py-3.5">
                                <div className="font-medium">{material.name}</div>
                                <div className="mt-1 max-w-sm text-muted-foreground">
                                  {product.supplierDescription}
                                </div>
                              </td>
                              <td className="px-4 py-3.5 text-muted-foreground">
                                {material.specification}
                              </td>
                              <td className="px-4 py-3.5 text-muted-foreground">
                                {material.purchaseFormat}
                              </td>
                              <td className="px-4 py-3.5">
                                {product.supplierName}
                                {product.preferred ? "" : " (additional)"}
                              </td>
                              <td className="px-4 py-3.5">
                                {formatOpeningPrice(product.price)} / {product.priceUnit}
                              </td>
                              <td className="px-4 py-3.5">{derived}</td>
                              <td className="px-4 py-3.5">
                                <StatusBadge status={badge.status} label={badge.label} />
                              </td>
                              <td className="px-4 py-3.5 text-muted-foreground">
                                {product.note}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Preserved</h2>
            <Card className="portal-surface">
              <CardContent className="space-y-3 p-6 text-sm">
                {plan.preserved.map((item) => (
                  <p key={item.name}>
                    <span className="font-medium">{item.name}.</span> {item.note}
                  </p>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Skipped</h2>
            <Card className="portal-surface">
              <CardContent className="space-y-3 p-6 text-sm">
                {plan.skipped.map((item) => (
                  <p key={item.label}>
                    <span className="font-medium">{item.label}.</span> {item.reason}
                  </p>
                ))}
              </CardContent>
            </Card>
          </section>

          {plan.canCommit ? (
            <Card className="portal-surface">
              <CardContent className="space-y-4 p-6">
                <p className="text-sm text-muted-foreground">
                  Commit sends the approved plan to{" "}
                  <code className="text-xs">apply_initial_materials_import</code> with
                  confirmation phrase{" "}
                  <code className="text-xs">{INITIAL_IMPORT_CONFIRMATION}</code>.
                </p>
                <div className="flex items-start gap-3">
                  <input
                    id="confirm-import"
                    type="checkbox"
                    className="mt-1"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <Label htmlFor="confirm-import">
                    I have reviewed the {batchImportLabel(catalogVersion)} dry import
                    and want to write only these approved rows.
                  </Label>
                </div>
                <Button
                  type="button"
                  disabled={!confirmed || pending != null}
                  onClick={() => run("commit")}
                >
                  {pending === "commit"
                    ? "Importing…"
                    : `Confirm ${batchImportLabel(catalogVersion)}`}
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
