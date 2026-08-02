"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  FileText,
  Handshake,
  Mail,
  MessageSquare,
  Phone,
  Pin,
  Quote,
  User,
  Users,
} from "lucide-react";

import { CrmActivityActorDisplay } from "@/components/crm/crm-activity-actor-display";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  categorizeCrmActivityType,
  formatActivityTypeLabel,
  type CrmTimelineCategory,
} from "@/lib/crm/activity-types";
import { formatCrmNoteTypeLabel, type CrmNoteType } from "@/lib/crm/crm-note-types";
import type {
  CrmTimelineDateFilter,
  CrmTimelineItem,
} from "@/lib/crm/get-crm-timeline";
import { formatCrmDate, formatCrmDateTime } from "@/lib/crm/format-datetime";
import { cn } from "@/lib/utils";

const categoryFilters: { id: CrmTimelineCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "notes", label: "Notes" },
  { id: "contacts", label: "Contacts" },
  { id: "opportunities", label: "Opportunities" },
  { id: "quotes", label: "Quotes" },
  { id: "tasks", label: "Tasks" },
  { id: "portal", label: "Portal" },
];

const dateFilters: { id: CrmTimelineDateFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

function ActivityIcon({ activityType }: { activityType: string }) {
  const className = "h-4 w-4 text-muted-foreground";

  if (activityType.startsWith("note_") || activityType === "note") {
    return <MessageSquare className={className} aria-hidden="true" />;
  }

  if (activityType.startsWith("task_")) {
    return <FileText className={className} aria-hidden="true" />;
  }

  if (activityType.startsWith("quote_")) {
    return <Quote className={className} aria-hidden="true" />;
  }

  if (activityType.startsWith("contact_") || activityType.startsWith("portal_")) {
    return <User className={className} aria-hidden="true" />;
  }

  if (activityType.startsWith("company_") || activityType === "payment_terms_changed") {
    return <Building2 className={className} aria-hidden="true" />;
  }

  if (activityType.includes("collaborator") || activityType === "owner_changed") {
    return <Users className={className} aria-hidden="true" />;
  }

  if (activityType.includes("phone")) {
    return <Phone className={className} aria-hidden="true" />;
  }

  if (activityType.includes("email") || activityType.includes("invitation")) {
    return <Mail className={className} aria-hidden="true" />;
  }

  return <Handshake className={className} aria-hidden="true" />;
}

function groupItemsByDate(items: CrmTimelineItem[]) {
  const groups = new Map<string, CrmTimelineItem[]>();

  for (const item of items) {
    const key = formatCrmDate(item.created_at);
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  }

  return [...groups.entries()];
}

function renderMetadataDetails(item: CrmTimelineItem) {
  const metadata = item.metadata;
  const details: string[] = [];

  if (typeof metadata.previous_stage === "string" && typeof metadata.new_stage === "string") {
    details.push(`${metadata.previous_stage} → ${metadata.new_stage}`);
  }

  if (typeof metadata.note_type === "string") {
    details.push(formatCrmNoteTypeLabel(metadata.note_type as CrmNoteType));
  }

  if (typeof metadata.quote_number === "number") {
    details.push(`Q-${metadata.quote_number}`);
  }

  return details;
}

type ActivityTimelineProps = {
  items: CrmTimelineItem[];
  title?: string;
  description?: string;
  showFilters?: boolean;
  initialCategory?: CrmTimelineCategory;
  initialDateFilter?: CrmTimelineDateFilter;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  compact?: boolean;
};

export function ActivityTimeline({
  items,
  title = "Activity",
  description = "Recent CRM activity for this record.",
  showFilters = true,
  initialCategory = "all",
  initialDateFilter = "all",
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  compact = false,
}: ActivityTimelineProps) {
  const [category, setCategory] = useState<CrmTimelineCategory>(initialCategory);
  const [dateFilter, setDateFilter] =
    useState<CrmTimelineDateFilter>(initialDateFilter);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filteredItems = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      dateFilter === "today"
        ? new Date().setHours(0, 0, 0, 0)
        : dateFilter === "7d"
          ? now - 7 * 24 * 60 * 60 * 1000
          : dateFilter === "30d"
            ? now - 30 * 24 * 60 * 60 * 1000
            : null;

    return items.filter((item) => {
      if (category !== "all" && categorizeCrmActivityType(item.activity_type) !== category) {
        return false;
      }

      if (cutoffMs !== null && new Date(item.created_at).getTime() < cutoffMs) {
        return false;
      }

      return true;
    });
  }, [items, category, dateFilter]);

  const groupedItems = groupItemsByDate(filteredItems);

  const content =
    filteredItems.length === 0 ? (
      <div className="px-6 py-8 text-sm text-muted-foreground">
        No activity recorded for this filter yet.
      </div>
    ) : (
      <div className="space-y-6 px-6 py-4">
        {groupedItems.map(([dateLabel, dayItems]) => (
          <div key={dateLabel}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {dateLabel}
            </p>
            <div className="space-y-0 border-l border-border pl-4">
              {dayItems.map((item) => {
                const metadataDetails = renderMetadataDetails(item);
                const isExpanded = expandedIds.has(item.id);

                return (
                  <div key={item.id} className="relative pb-5 last:pb-0">
                    <span className="absolute -left-[1.37rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                      <ActivityIcon activityType={item.activity_type} />
                    </span>

                    <div className="rounded-xl border border-border/70 bg-background/80 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {item.source === "note"
                              ? formatCrmNoteTypeLabel(
                                  (item.metadata.note_type as CrmNoteType) ?? "note"
                                )
                              : formatActivityTypeLabel(item.activity_type)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs text-muted-foreground">
                          {formatCrmDateTime(item.created_at)}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {item.actor_name ? (
                          <div className="flex items-center gap-2">
                            <CrmActivityActorDisplay
                              actorProfileId={item.actor_profile_id}
                              actorName={item.actor_name}
                              actorAvatarUrl={item.actor_avatar_url}
                              size="sm"
                            />
                            <span className="text-sm text-muted-foreground">
                              {item.actor_name}
                            </span>
                          </div>
                        ) : null}

                        {item.linked_record_label && item.linked_record_href ? (
                          <Link
                            href={item.linked_record_href}
                            className="text-sm font-medium text-foreground hover:underline"
                          >
                            {item.linked_record_label}
                          </Link>
                        ) : null}
                      </div>

                      {metadataDetails.length > 0 ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedIds((current) => {
                                const next = new Set(current);
                                if (next.has(item.id)) {
                                  next.delete(item.id);
                                } else {
                                  next.add(item.id);
                                }
                                return next;
                              });
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                          >
                            Details
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                isExpanded && "rotate-180"
                              )}
                              aria-hidden="true"
                            />
                          </button>
                          {isExpanded ? (
                            <div className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              {metadataDetails.join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {hasMore && onLoadMore ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    );

  if (compact) {
    return <div>{content}</div>;
  }

  return (
    <Card className="portal-surface overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>

        {showFilters ? (
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap gap-2">
              {categoryFilters.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setCategory(option.id)}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                    category === option.id
                      ? "bg-muted text-foreground ring-1 ring-border"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {dateFilters.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDateFilter(option.id)}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                    dateFilter === option.id
                      ? "bg-muted text-foreground ring-1 ring-border"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
