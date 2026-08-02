import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  softDeleteCrmNote,
  updateCrmNote,
} from "@/lib/crm/get-crm-timeline";
import { createClient } from "@/lib/supabase/server";

type UpdateNoteBody = {
  body?: string;
  noteType?: string;
  isPinned?: boolean;
};

type NoteLinks = {
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  quote_id: string | null;
  task_id: string | null;
};

function revalidateNoteRecordPaths(note: NoteLinks) {
  if (note.company_id) {
    revalidatePath(`/admin/companies/${note.company_id}`);
  }
  if (note.contact_id) {
    revalidatePath(`/admin/customers/${note.contact_id}`);
  }
  if (note.opportunity_id) {
    revalidatePath(`/admin/opportunities/${note.opportunity_id}`);
  }
  if (note.quote_id) {
    revalidatePath(`/admin/quotes/${note.quote_id}`);
  }
  if (note.task_id) {
    revalidatePath(`/admin/tasks/${note.task_id}/edit`);
  }
  revalidatePath("/admin");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: UpdateNoteBody;

  try {
    body = (await request.json()) as UpdateNoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const isAdmin = ["super_admin", "admin"].includes(auth.userRole);

  try {
    await updateCrmNote(supabase, {
      noteId: id,
      body: body.body,
      noteType: body.noteType,
      isPinned: body.isPinned,
      actorProfileId: auth.userId,
      isAdmin,
    });

    const { data: note } = await supabase
      .from("crm_notes")
      .select(
        "company_id, contact_id, opportunity_id, quote_id, task_id"
      )
      .eq("id", id)
      .maybeSingle();

    if (note) {
      revalidateNoteRecordPaths(note);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update note.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { data: note } = await supabase
    .from("crm_notes")
    .select("company_id, contact_id, opportunity_id, quote_id, task_id, created_by")
    .eq("id", id)
    .maybeSingle();

  if (!note) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const isAdmin = ["super_admin", "admin"].includes(auth.userRole);

  try {
    await softDeleteCrmNote(supabase, {
      noteId: id,
      actorProfileId: auth.userId,
      isAdmin,
    });

    revalidateNoteRecordPaths(note);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete note.",
      },
      { status: 400 }
    );
  }
}
