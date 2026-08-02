"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OPPORTUNITY_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createClient } from "@/lib/supabase/client";

type OpportunityNoteFormProps = {
  opportunityId: string;
  currentUserId: string;
};

export function OpportunityNoteForm({
  opportunityId,
  currentUserId,
}: OpportunityNoteFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [body, setBody] = useState("");
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
      const { error: insertError } = await supabase
        .from("opportunity_notes")
        .insert({
          opportunity_id: opportunityId,
          body: trimmedBody,
          created_by: currentUserId,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      const { error: activityError } = await supabase
        .from("opportunity_activity")
        .insert({
          opportunity_id: opportunityId,
          activity_type: OPPORTUNITY_ACTIVITY_TYPES.noteAdded,
          description: "Note added.",
          metadata: {},
          created_by: currentUserId,
        });

      if (activityError) {
        throw new Error(activityError.message);
      }

      setBody("");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to add note."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="noteBody">Add note</Label>
        <Textarea
          id="noteBody"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder="Write an internal note…"
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}
