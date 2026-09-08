"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRODUCT_UPDATE_AUDIENCES,
  PRODUCT_UPDATE_CATEGORIES,
  formatProductUpdateAudienceLabel,
  formatProductUpdateCategoryLabel,
  type ProductUpdateAudience,
  type ProductUpdateCategory,
  type ProductUpdateRecord,
} from "@/lib/updates/types";

type ProductUpdateFormProps = {
  mode: "create" | "edit";
  updateId?: string;
  initialValues?: Partial<ProductUpdateRecord>;
  cancelHref: string;
};

export function ProductUpdateForm({
  mode,
  updateId,
  initialValues,
  cancelHref,
}: ProductUpdateFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [body, setBody] = useState(initialValues?.body ?? "");
  const [category, setCategory] = useState<ProductUpdateCategory>(
    initialValues?.category ?? "improvement"
  );
  const [audience, setAudience] = useState<ProductUpdateAudience>(
    initialValues?.audience ?? "everyone"
  );
  const [isPublished, setIsPublished] = useState(
    initialValues?.is_published ?? false
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const endpoint =
      mode === "create" ? "/api/admin/updates" : `/api/admin/updates/${updateId}`;
    const method = mode === "create" ? "POST" : "PATCH";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          body,
          category,
          audience,
          isPublished,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save update.");
        return;
      }

      router.push("/admin/updates");
      router.refresh();
    } catch {
      setError("Unable to save update.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">
          {mode === "create" ? "Create update" : "Edit update"}
        </CardTitle>
        <CardDescription>
          Write customer-friendly release notes for Candid OS.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="update-title">Title</Label>
            <Input
              id="update-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="update-body">Summary / body</Label>
            <textarea
              id="update-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={8}
              disabled={isSubmitting}
              className="min-h-40 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="update-category">Category</Label>
              <select
                id="update-category"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as ProductUpdateCategory)
                }
                disabled={isSubmitting}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
              >
                {PRODUCT_UPDATE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {formatProductUpdateCategoryLabel(value)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="update-audience">Audience</Label>
              <select
                id="update-audience"
                value={audience}
                onChange={(event) =>
                  setAudience(event.target.value as ProductUpdateAudience)
                }
                disabled={isSubmitting}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
              >
                {PRODUCT_UPDATE_AUDIENCES.map((value) => (
                  <option key={value} value={value}>
                    {formatProductUpdateAudienceLabel(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(event) => setIsPublished(event.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-border"
            />
            Publish this update
          </label>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : mode === "create" ? "Create update" : "Save changes"}
            </Button>
            <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
              Cancel
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
