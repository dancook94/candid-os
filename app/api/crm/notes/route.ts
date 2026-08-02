import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createCrmNote } from "@/lib/crm/create-crm-note";
import { createClient } from "@/lib/supabase/server";

type CreateNoteBody = {
  body?: string;
  noteType?: string;
  isPinned?: boolean;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  quoteId?: string | null;
  taskId?: string | null;
};

function revalidateNotePaths(body: CreateNoteBody) {
  if (body.companyId) {
    revalidatePath(`/admin/companies/${body.companyId}`);
  }
  if (body.contactId) {
    revalidatePath(`/admin/customers/${body.contactId}`);
  }
  if (body.opportunityId) {
    revalidatePath(`/admin/opportunities/${body.opportunityId}`);
  }
  if (body.quoteId) {
    revalidatePath(`/admin/quotes/${body.quoteId}`);
  }
  if (body.taskId) {
    revalidatePath(`/admin/tasks/${body.taskId}/edit`);
  }
  revalidatePath("/admin");
  revalidatePath("/admin/activity");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: CreateNoteBody;

  try {
    body = (await request.json()) as CreateNoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const { noteId, activityId } = await createCrmNote(supabase, {
      body: body.body ?? "",
      noteType: body.noteType ?? "note",
      isPinned: body.isPinned ?? false,
      companyId: body.companyId,
      contactId: body.contactId,
      opportunityId: body.opportunityId,
      quoteId: body.quoteId,
      taskId: body.taskId,
      createdBy: auth.userId,
    });

    revalidateNotePaths(body);

    return NextResponse.json({ id: noteId, activityId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create note.";

    if (process.env.NODE_ENV === "development") {
      console.error("[crm notes api] create failed:", message);
    }

    return NextResponse.json(
      {
        error: message,
      },
      { status: 400 }
    );
  }
}
