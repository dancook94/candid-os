import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  deleteProductUpdate,
  updateProductUpdate,
  validateProductUpdateInput,
} from "@/lib/updates/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateUpdateBody = {
  title?: string;
  body?: string;
  category?: string;
  audience?: string;
  isPublished?: boolean;
  publishedAt?: string | null;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id: updateId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: UpdateUpdateBody;

  try {
    body = (await request.json()) as UpdateUpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateProductUpdateInput(body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  const result = await updateProductUpdate(supabase, updateId, {
    title: validation.value.title,
    body: validation.value.body,
    category: validation.value.category,
    audience: validation.value.audience,
    isPublished: Boolean(body.isPublished),
    publishedAt: body.publishedAt ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, update: result.update });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id: updateId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  const result = await deleteProductUpdate(supabase, updateId);

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
