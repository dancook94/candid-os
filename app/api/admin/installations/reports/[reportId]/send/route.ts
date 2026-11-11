import { NextResponse } from "next/server";

import {
  listInstallationReportDeliveries,
  sendInstallationReportToCustomer,
} from "@/lib/installations/report-delivery";
import { canManageInstallations } from "@/lib/installations/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ reportId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { reportId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status, user_role")
    .eq("id", user.id)
    .single();

  if (!canManageInstallations(profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const deliveries = await listInstallationReportDeliveries(createAdminClient(), reportId);
    return NextResponse.json({ deliveries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delivery history is not available." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { reportId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status, user_role")
    .eq("id", user.id)
    .single();

  if (!canManageInstallations(profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    recipientEmail?: string;
    message?: string;
    attachPdf?: boolean;
    confirmResend?: boolean;
    acknowledgeNoPortalAccess?: boolean;
  } | null;

  if (!body?.recipientEmail?.trim()) {
    return NextResponse.json({ error: "Enter a customer email address." }, { status: 400 });
  }

  const result = await sendInstallationReportToCustomer({
    reportId,
    recipientEmail: body.recipientEmail,
    customerMessage: body.message,
    attachPdf: Boolean(body.attachPdf),
    confirmResend: Boolean(body.confirmResend),
    acknowledgeNoPortalAccess: Boolean(body.acknowledgeNoPortalAccess),
    sentByProfileId: user.id,
  });

  if (result.requiresPortalAcknowledgement) {
    return NextResponse.json(
      { error: result.error, requiresPortalAcknowledgement: true },
      { status: 409 }
    );
  }

  if (result.duplicate) {
    return NextResponse.json({ error: result.error, duplicate: true }, { status: 409 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "The email could not be sent." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    deliveryId: result.deliveryId,
    notificationId: result.notificationId,
  });
}
