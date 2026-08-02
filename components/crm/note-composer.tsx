"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CRM_NOTE_TYPES,
  formatCrmNoteTypeLabel,
  type CrmNoteType,
} from "@/lib/crm/crm-note-types";

export type CrmNoteContext = {
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  quoteId?: string | null;
  taskId?: string | null;
};

type NoteComposerProps = {
  context: CrmNoteContext;
  defaultNoteType?: CrmNoteType;
  compact?: boolean;
};

export function NoteComposer({
  context,
  defaultNoteType = "note",
  compact = false,
}: NoteComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [noteType, setNoteType] = useState<CrmNoteType>(defaultNoteType);
  const [isPinned, setIsPinned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedBody = body.trim();

    if (!trimmedBody) {
      setError("Note body is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/crm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmedBody,
          noteType,
          isPinned,
          companyId: context.companyId,
          contactId: context.contactId,
          opportunityId: context.opportunityId,
          quoteId: context.quoteId,
          taskId: context.taskId,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save note.");
      }

      setBody("");
      setIsPinned(false);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save note."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr]">
        <div className="space-y-2">
          <Label htmlFor="note-type">Note type</Label>
          <Select
            id="note-type"
            value={noteType}
            onChange={(event) => setNoteType(event.target.value as CrmNoteType)}
          >
            {CRM_NOTE_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatCrmNoteTypeLabel(type)}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="note-body">Note</Label>
          <Textarea
            id="note-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add an internal note..."
            rows={compact ? 3 : 4}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(event) => setIsPinned(event.target.checked)}
          />
          Pin note
        </label>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save note"}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
