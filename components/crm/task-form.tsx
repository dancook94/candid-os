"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { StaffMultiSelect } from "@/components/crm/staff-multi-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CrmStaffProfile } from "@/lib/crm/crm-staff";
import {
  getTaskPriorityOptions,
  getTaskStatusOptions,
} from "@/lib/crm/task-config";
import {
  parseDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/crm/format-datetime";
import type { TaskPriority, TaskStatus } from "@/lib/crm/types";

type CompanyOption = {
  id: string;
  company_name: string;
};

type OpportunityOption = {
  id: string;
  title: string;
  company_id: string;
};

type QuoteOption = {
  id: string;
  project_name: string;
  opportunity_id: string | null;
  quote_number: number;
};

type TaskFormProps = {
  mode: "create" | "edit";
  crmStaff: CrmStaffProfile[];
  companies: CompanyOption[];
  opportunities: OpportunityOption[];
  quotes: QuoteOption[];
  currentUserId: string;
  taskId?: string;
  lockedOpportunityId?: string | null;
  lockedCompanyId?: string | null;
  initialValues?: {
    title: string;
    description: string;
    assigneeProfileIds: string[];
    dueAt: string;
    priority: TaskPriority;
    status: TaskStatus;
    opportunityId: string;
    quoteId: string;
    companyId: string;
  };
  cancelHref: string;
  successHref?: string;
};

export function TaskForm({
  mode,
  crmStaff,
  companies,
  opportunities,
  quotes,
  currentUserId,
  taskId,
  lockedOpportunityId,
  lockedCompanyId,
  initialValues,
  cancelHref,
  successHref,
}: TaskFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? ""
  );
  const [assigneeProfileIds, setAssigneeProfileIds] = useState<string[]>(
    initialValues?.assigneeProfileIds ?? [currentUserId]
  );
  const [dueAt, setDueAt] = useState(initialValues?.dueAt ?? "");
  const [priority, setPriority] = useState<TaskPriority>(
    initialValues?.priority ?? "normal"
  );
  const [status, setStatus] = useState<TaskStatus>(
    initialValues?.status ?? "open"
  );
  const [opportunityId, setOpportunityId] = useState(
    lockedOpportunityId ?? initialValues?.opportunityId ?? ""
  );
  const [quoteId, setQuoteId] = useState(initialValues?.quoteId ?? "");
  const [companyId, setCompanyId] = useState(
    lockedCompanyId ?? initialValues?.companyId ?? ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isOpportunityLocked = Boolean(lockedOpportunityId);
  const isCompanyLocked = Boolean(lockedCompanyId || lockedOpportunityId);

  const validQuotes = useMemo(() => {
    if (!opportunityId) {
      return [];
    }

    return quotes.filter((quote) => quote.opportunity_id === opportunityId);
  }, [quotes, opportunityId]);

  useEffect(() => {
    if (!opportunityId) {
      return;
    }

    const linkedOpportunity = opportunities.find(
      (opportunity) => opportunity.id === opportunityId
    );

    if (linkedOpportunity) {
      setCompanyId(linkedOpportunity.company_id);
    }

    if (quoteId) {
      const linkedQuote = quotes.find((quote) => quote.id === quoteId);

      if (linkedQuote?.opportunity_id !== opportunityId) {
        setQuoteId("");
      }
    }
  }, [opportunityId, opportunities, quoteId, quotes]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError("Task title is required.");
      return;
    }

    if (assigneeProfileIds.length === 0) {
      setError("At least one assignee is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        title: trimmedTitle,
        description: description.trim() || null,
        assigneeProfileIds,
        dueAt: parseDateTimeLocalValue(dueAt),
        priority,
        status,
        opportunityId: opportunityId || null,
        quoteId: quoteId || null,
        companyId: companyId || null,
      };

      const endpoint =
        mode === "create"
          ? "/api/crm/tasks"
          : `/api/crm/tasks/${taskId}`;

      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as {
        error?: string;
        taskId?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save task.");
      }

      router.push(
        successHref ??
          (payload.opportunityId
            ? `/admin/opportunities/${payload.opportunityId}`
            : "/admin/tasks")
      );
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save task."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="portal-surface">
      <CardHeader>
        <CardTitle>{mode === "create" ? "New task" : "Edit task"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <StaffMultiSelect
                staff={crmStaff}
                selectedIds={assigneeProfileIds}
                onChange={setAssigneeProfileIds}
                minSelected={1}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueAt">Due date and time</Label>
              <Input
                id="dueAt"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                id="priority"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TaskPriority)
                }
              >
                {getTaskPriorityOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                id="status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as TaskStatus)
                }
              >
                {getTaskStatusOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="opportunity">Linked opportunity</Label>
              <Select
                id="opportunity"
                value={opportunityId}
                onChange={(event) => setOpportunityId(event.target.value)}
                disabled={isOpportunityLocked}
              >
                <option value="">None</option>
                {opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>
                    {opportunity.title}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote">Linked quote</Label>
              <Select
                id="quote"
                value={quoteId}
                onChange={(event) => setQuoteId(event.target.value)}
                disabled={!opportunityId}
              >
                <option value="">None</option>
                {validQuotes.map((quote) => (
                  <option key={quote.id} value={quote.id}>
                    Q-{quote.quote_number} · {quote.project_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="company">Company</Label>
              <Select
                id="company"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                disabled={isCompanyLocked}
              >
                <option value="">None</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : mode === "create"
                  ? "Create task"
                  : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(cancelHref)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function buildTaskFormInitialValues(task: {
  title: string;
  description: string | null;
  assigned_to: string;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  opportunity_id: string | null;
  quote_id: string | null;
  company_id: string | null;
}, assigneeProfileIds?: string[]) {
  return {
    title: task.title,
    description: task.description ?? "",
    assigneeProfileIds:
      assigneeProfileIds && assigneeProfileIds.length > 0
        ? assigneeProfileIds
        : [task.assigned_to],
    dueAt: toDateTimeLocalValue(task.due_at),
    priority: task.priority,
    status: task.status,
    opportunityId: task.opportunity_id ?? "",
    quoteId: task.quote_id ?? "",
    companyId: task.company_id ?? "",
  };
}
