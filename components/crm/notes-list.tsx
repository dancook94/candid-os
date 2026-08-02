"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Pin,
  StickyNote,
  Users,
} from "lucide-react";

import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CRM_NOTE_TYPES,
  formatCrmNoteTypeLabel,
  type CrmNoteType,
} from "@/lib/crm/crm-note-types";
import type { CrmNoteListItem } from "@/lib/crm/get-crm-timeline";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import { cn } from "@/lib/utils";

function NoteTypeIcon({ noteType }: { noteType: CrmNoteType }) {
  const className = "h-4 w-4";

  switch (noteType) {
    case "phone_call":
      return <Phone className={className} aria-hidden="true" />;
    case "meeting":
      return <Users className={className} aria-hidden="true" />;
    case "site_visit":
      return <MapPin className={className} aria-hidden="true" />;
    case "email_summary":
      return <Mail className={className} aria-hidden="true" />;
    case "internal":
      return <StickyNote className={className} aria-hidden="true" />;
    default:
      return <MessageSquare className={className} aria-hidden="true" />;
  }
}

function wasEdited(note: CrmNoteListItem) {
  return (
    new Date(note.updated_at).getTime() -
      new Date(note.created_at).getTime() >
    60_000
  );
}

type NotesListProps = {
  notes: CrmNoteListItem[];
  emptyTitle?: string;
  emptyDescription?: string;
};

export function NotesList({
  notes,
  emptyTitle = "No notes yet",
  emptyDescription = "Internal notes will appear here.",
}: NotesListProps) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyTitle}. {emptyDescription}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: CrmNoteListItem }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [noteType, setNoteType] = useState(note.note_type);
  const [isPinned, setIsPinned] = useState(note.is_pinned);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  async function saveChanges() {
    setError("");
    setIsSaving(true);

    try {
      const response = await fetch(`/api/crm/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          noteType,
          isPinned,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update note.");
      }

      setIsEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to update note."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePin() {
    setError("");
    setIsSaving(true);

    try {
      const response = await fetch(`/api/crm/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned: !note.is_pinned }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update note.");
      }

      router.refresh();
    } catch (pinError) {
      setError(
        pinError instanceof Error ? pinError.message : "Unable to update note."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteNote() {
    if (!window.confirm("Delete this note?")) {
      return;
    }

    setError("");
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/crm/notes/${note.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete note.");
      }

      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete note."
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border p-4",
        note.is_pinned && "border-amber-300/70 bg-amber-50/40"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StaffAvatarDisplay
            fullName={note.author_name}
            avatarUrl={note.author_avatar_url}
            size="sm"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                <NoteTypeIcon noteType={note.note_type} />
                {formatCrmNoteTypeLabel(note.note_type)}
              </span>
              {note.is_pinned ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                  <Pin className="h-3 w-3" aria-hidden="true" />
                  Pinned
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {note.author_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatCrmDateTime(note.created_at)}
              {wasEdited(note) ? " · Edited" : ""}
            </p>
          </div>
        </div>

        {note.linked_record_label && note.linked_record_href ? (
          <Link
            href={note.linked_record_href}
            className="text-xs font-medium text-foreground hover:underline"
          >
            {note.linked_record_label}
          </Link>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`note-type-${note.id}`}>Note type</Label>
            <Select
              id={`note-type-${note.id}`}
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
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(event) => setIsPinned(event.target.checked)}
            />
            Pin note
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={saveChanges} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsEditing(false);
                setBody(note.body);
                setNoteType(note.note_type);
                setIsPinned(note.is_pinned);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {note.body}
        </p>
      )}

      {!isEditing && (note.can_edit || note.can_delete) ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {note.can_edit ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={togglePin}
                disabled={isSaving}
              >
                {note.is_pinned ? "Unpin" : "Pin"}
              </Button>
            </>
          ) : null}
          {note.can_delete ? (
            <Button
              size="sm"
              variant="outline"
              onClick={deleteNote}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
