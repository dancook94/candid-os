import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

type ResendWebhookEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    bounce?: { message?: string };
  };
};

function verifySvixSignature(
  payload: string,
  headers: Headers,
  secret: string
) {
  const msgId = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");

  if (!msgId || !timestamp || !signatureHeader) {
    return false;
  }

  const signedContent = `${msgId}.${timestamp}.${payload}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");

  for (const part of signatureHeader.split(" ")) {
    const [version, signature] = part.split(",");

    if (version !== "v1" || !signature) {
      continue;
    }

    const digest = createHmac("sha256", secretBytes)
      .update(signedContent)
      .digest("base64");

    const expected = Buffer.from(digest);
    const received = Buffer.from(signature);

    if (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    ) {
      return true;
    }
  }

  return false;
}

function mapWebhookStatus(type: string | undefined) {
  switch (type) {
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "failed";
    case "email.delivery_delayed":
    case "email.failed":
      return "failed";
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const rawBody = await request.text();

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Webhook received but RESEND_WEBHOOK_SECRET is not configured. Configure the secret and Resend webhook endpoint to enable delivery updates.",
      },
      { status: 501 }
    );
  }

  if (!verifySvixSignature(rawBody, request.headers, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let event: ResendWebhookEvent;

  try {
    event = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const providerMessageId = event.data?.email_id;
  const nextStatus = mapWebhookStatus(event.type);

  if (!providerMessageId || !nextStatus) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: nextStatus,
    updated_at: now,
  };

  if (nextStatus === "delivered") {
    update.delivered_at = now;
  }

  if (nextStatus === "failed" || nextStatus === "bounced") {
    update.failed_at = now;
    update.error_message =
      event.data?.bounce?.message ?? `Resend webhook: ${event.type ?? "failed"}`;
  }

  const { error } = await adminClient
    .from("notifications")
    .update(update)
    .eq("provider_message_id", providerMessageId);

  if (error && error.code !== "42P01") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
