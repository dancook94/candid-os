import { Card, CardContent } from "@/components/ui/card";
import { UpdateCategoryBadge } from "@/components/updates/update-category-badge";
import type { ProductUpdateRecord } from "@/lib/updates/types";

type UpdatesFeedProps = {
  updates: ProductUpdateRecord[];
};

function formatPublishedDate(dateString: string | null) {
  if (!dateString) {
    return "";
  }

  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function UpdatesFeed({ updates }: UpdatesFeedProps) {
  if (updates.length === 0) {
    return (
      <Card className="portal-surface rounded-2xl shadow-sm ring-0">
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No updates have been published yet. Check back soon.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {updates.map((update) => (
        <Card
          key={update.id}
          className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0"
        >
          <CardContent className="p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <UpdateCategoryBadge category={update.category} />
              {!update.is_published ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Draft
                </span>
              ) : null}
            </div>

            <h3 className="text-lg font-semibold text-foreground">{update.title}</h3>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {update.body}
            </p>

            <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {formatPublishedDate(update.published_at || update.created_at)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
