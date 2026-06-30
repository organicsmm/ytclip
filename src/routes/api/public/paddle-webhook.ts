import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// Paddle "Notifications" → app webhook.
// Signature header: `Paddle-Signature: ts=<unix>;h1=<hex>`
// h1 = HMAC-SHA256(`${ts}:${rawBody}`, notification_secret)
// Docs: https://developer.paddle.com/webhooks/signature-verification

function parsePaddleSignature(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim(), v?.trim()];
    }),
  ) as Record<string, string>;
  if (!parts.ts || !parts.h1) return null;
  return { ts: parts.ts, h1: parts.h1 };
}

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  const sig = parsePaddleSignature(header);
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(`${sig.ts}:${rawBody}`).digest("hex");
  const a = Buffer.from(sig.h1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type PaddlePlan = "starter" | "pro";

function priceIdToPlan(priceId: string | undefined | null): PaddlePlan | null {
  if (!priceId) return null;
  if (priceId === process.env.PADDLE_PRICE_STARTER) return "starter";
  if (priceId === process.env.PADDLE_PRICE_PRO) return "pro";
  return null;
}

// Map Paddle subscription status → our status string.
// Active / trialing keep paid plan; everything else falls back to free in get_user_quota.
function normalizeStatus(s?: string): string {
  return (s ?? "active").toLowerCase();
}

interface PaddleSubscriptionPayload {
  id?: string;
  status?: string;
  current_billing_period?: { ends_at?: string };
  next_billed_at?: string;
  items?: Array<{ price?: { id?: string } | null; status?: string }>;
  custom_data?: Record<string, unknown> | null;
}

interface PaddleEvent {
  event_type?: string;
  data?: PaddleSubscriptionPayload;
}

export const Route = createFileRoute("/api/public/paddle-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PADDLE_NOTIFICATION_SECRET;
        if (!secret) {
          console.error("[paddle-webhook] PADDLE_NOTIFICATION_SECRET not set");
          return new Response("Webhook secret not configured", { status: 500 });
        }

        const raw = await request.text();
        const ok = verifySignature(raw, request.headers.get("paddle-signature"), secret);
        if (!ok) {
          console.warn("[paddle-webhook] invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        let evt: PaddleEvent;
        try {
          evt = JSON.parse(raw) as PaddleEvent;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const eventType = evt.event_type ?? "";
        const sub = evt.data ?? {};
        const userId =
          (sub.custom_data && (sub.custom_data["user_id"] as string)) ||
          (sub.custom_data && (sub.custom_data["userId"] as string)) ||
          null;
        const paddleSubId = sub.id ?? null;

        if (!userId) {
          console.warn("[paddle-webhook] missing custom_data.user_id, event ignored", {
            eventType,
            paddleSubId,
          });
          return new Response("ok", { status: 200 });
        }

        const priceId = sub.items?.[0]?.price?.id ?? null;
        const plan = priceIdToPlan(priceId) ?? "free";
        const status = normalizeStatus(sub.status);
        const periodEnd = sub.current_billing_period?.ends_at ?? sub.next_billed_at ?? null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          switch (eventType) {
            case "subscription.created":
            case "subscription.activated":
            case "subscription.updated":
            case "subscription.resumed":
            case "subscription.trialing":
            case "subscription.past_due":
            case "subscription.paused": {
              const { error } = await supabaseAdmin
                .from("subscriptions")
                .upsert(
                  {
                    user_id: userId,
                    plan: status === "active" || status === "trialing" ? plan : "free",
                    status,
                    paddle_subscription_id: paddleSubId,
                    current_period_end: periodEnd,
                  },
                  { onConflict: "user_id" },
                );
              if (error) throw error;
              break;
            }
            case "subscription.canceled": {
              const { error } = await supabaseAdmin
                .from("subscriptions")
                .upsert(
                  {
                    user_id: userId,
                    plan: "free",
                    status: "canceled",
                    paddle_subscription_id: paddleSubId,
                    current_period_end: periodEnd,
                  },
                  { onConflict: "user_id" },
                );
              if (error) throw error;
              break;
            }
            default:
              // Acknowledge unhandled event types so Paddle doesn't retry.
              console.log("[paddle-webhook] unhandled event_type", eventType);
          }
        } catch (e) {
          console.error("[paddle-webhook] DB write failed", e);
          return new Response("DB write failed", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
