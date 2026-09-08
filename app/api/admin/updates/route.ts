import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  createProductUpdate,
  validateProductUpdateInput,
} from "@/lib/updates/admin";
import { createClient } from "@/lib/supabase/server";

type CreateUpdateBody = {
  title?: string;
  body?: string;
  category?: string;
  audience?: string;
  isPublished?: boolean;
  publishedAt?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: CreateUpdateBody;

  try {
    body = (await request.json()) as CreateUpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateProductUpdateInput(body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  const result = await createProductUpdate(supabase, {
    title: validation.value.title,
    body: validation.value.body,
    category: validation.value.category,
    audience: validation.value.audience,
    isPublished: Boolean(body.isPublished),
    publishedAt: body.publishedAt ?? null,
    createdBy: authResult.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, update: result.update });
}
