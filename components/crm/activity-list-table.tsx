import Link from "next/link";
import {
  Building2,
  FileText,
  Handshake,
  Mail,
  MessageSquare,
  Phone,
  Quote,
  User,
  Users,
} from "lucide-react";

import { CrmActivityActorDisplay } from "@/components/crm/crm-activity-actor-display";
import { Button } from "@/components/ui/button";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { ActivityListItem } from "@/lib/crm/activity-list";
import { formatRoleLabel } from "@/lib/staff-roles";

function ActivityIcon({ activityType }: { activityType: string }) {
  const className = "h-4 w-4 text-muted-foreground";

  if (activityType.startsWith("note_")) {
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

type ActivityListTableProps = {
  items: ActivityListItem[];
  hasMore: boolean;
  loadMoreHref: string | null;
};

function ActivityRowContent({
  item,
  showPrimaryLink = true,
  showSecondaryLinks = true,
}: {
  item: ActivityListItem;
  showPrimaryLink?: boolean;
  showSecondaryLinks?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
        <ActivityIcon activityType={item.activity_type} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.description}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.actor_name ? (
            <span className="inline-flex items-center gap-2">
              <CrmActivityActorDisplay
                actorProfileId={item.actor_profile_id}
                actorName={item.actor_name}
                actorAvatarUrl={item.actor_avatar_url}
                size="sm"
              />
              <span>
                {item.actor_name}
                {item.actor_role ? (
                  <span className="text-muted-foreground/80">
                    {" "}
                    · {formatRoleLabel(item.actor_role)}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}

          {item.record_type_label ? <span>{item.record_type_label}</span> : null}

          {item.company_name ? <span>{item.company_name}</span> : null}

          <span>{formatCrmDateTime(item.created_at)}</span>
        </div>

        {showPrimaryLink && item.primary_link_label && item.primary_link_href ? (
          <div className="mt-2 text-xs">
            <Link
              href={item.primary_link_href}
              className="font-medium text-foreground hover:underline"
            >
              {item.primary_link_label}
            </Link>
          </div>
        ) : null}

        {!showPrimaryLink && item.primary_link_label ? (
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {item.primary_link_label}
          </p>
        ) : null}

        {showSecondaryLinks && item.secondary_links.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {item.secondary_links.map((link) => (
              <Link
                key={`${link.type}-${link.href}`}
                href={link.href}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ActivityListTable({
  items,
  hasMore,
  loadMoreHref,
}: ActivityListTableProps) {
  return (
    <div className="overflow-hidden">
      <div className="hidden border-b border-border bg-muted/20 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)] md:gap-4 md:px-6 md:py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Activity
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          User
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Record type
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Related record
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Company
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Date and time
        </p>
      </div>

      <div className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.id}>
            <div className="md:hidden">
              {item.primary_link_href ? (
                <Link
                  href={item.primary_link_href}
                  className="block px-4 py-4 transition-colors hover:bg-muted/30 sm:px-6"
                >
                  <ActivityRowContent
                    item={item}
                    showPrimaryLink={false}
                    showSecondaryLinks={false}
                  />
                </Link>
              ) : (
                <div className="px-4 py-4 sm:px-6">
                  <ActivityRowContent item={item} />
                </div>
              )}

              {item.secondary_links.length > 0 && item.primary_link_href ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-4 text-xs sm:px-6">
                  {item.secondary_links.map((link) => (
                    <Link
                      key={`${link.type}-${link.href}`}
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            {item.primary_link_href ? (
              <Link
                href={item.primary_link_href}
                className="hidden transition-colors hover:bg-muted/30 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)] md:items-center md:gap-4 md:px-6 md:py-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                    <ActivityIcon activityType={item.activity_type} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {item.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.activity_type_label}
                    </p>
                  </div>
                </div>

                <div className="min-w-0">
                  {item.actor_name ? (
                    <div className="flex items-center gap-2">
                      <CrmActivityActorDisplay
                        actorProfileId={item.actor_profile_id}
                        actorName={item.actor_name}
                        actorAvatarUrl={item.actor_avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          {item.actor_name}
                        </p>
                        {item.actor_role ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {formatRoleLabel(item.actor_role)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  {item.record_type_label ?? "—"}
                </p>

                <p className="truncate text-sm font-medium text-foreground">
                  {item.primary_link_label ?? "—"}
                </p>

                <p className="truncate text-sm text-muted-foreground">
                  {item.company_name ?? "—"}
                </p>

                <p className="text-sm text-muted-foreground">
                  {formatCrmDateTime(item.created_at)}
                </p>
              </Link>
            ) : (
              <div className="hidden md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)] md:items-center md:gap-4 md:px-6 md:py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                    <ActivityIcon activityType={item.activity_type} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {item.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.activity_type_label}
                    </p>
                  </div>
                </div>

                <div className="min-w-0">
                  {item.actor_name ? (
                    <div className="flex items-center gap-2">
                      <CrmActivityActorDisplay
                        actorProfileId={item.actor_profile_id}
                        actorName={item.actor_name}
                        actorAvatarUrl={item.actor_avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          {item.actor_name}
                        </p>
                        {item.actor_role ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {formatRoleLabel(item.actor_role)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  {item.record_type_label ?? "—"}
                </p>

                <p className="truncate text-sm text-muted-foreground">—</p>

                <p className="truncate text-sm text-muted-foreground">
                  {item.company_name ?? "—"}
                </p>

                <p className="text-sm text-muted-foreground">
                  {formatCrmDateTime(item.created_at)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && loadMoreHref ? (
        <div className="flex justify-center border-t border-border px-6 py-4">
          <Link href={loadMoreHref}>
            <Button variant="outline" size="sm">
              Load more
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
