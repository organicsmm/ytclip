import { initializePaddle, type Paddle, type Environments } from "@paddle/paddle-js";
import { supabase } from "@/integrations/supabase/client";

let paddlePromise: Promise<Paddle | undefined> | null = null;

type PaddleEvent = { name?: string };
const listeners = new Set<(e: PaddleEvent) => void>();

export function getPaddle(): Promise<Paddle | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  if (paddlePromise) return paddlePromise;

  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  const env = (import.meta.env.VITE_PADDLE_ENVIRONMENT as Environments | undefined) ?? "sandbox";

  if (!token) {
    console.warn(
      "[paddle] VITE_PADDLE_CLIENT_TOKEN is not set — checkout will not work until Paddle is enabled.",
    );
    return Promise.resolve(undefined);
  }

  paddlePromise = initializePaddle({
    environment: env,
    token,
    eventCallback: (event) => {
      listeners.forEach((fn) => {
        try {
          fn(event as PaddleEvent);
        } catch (err) {
          console.error("[paddle] listener threw", err);
        }
      });
    },
  });
  return paddlePromise;
}

export type PlanId = "starter" | "pro";

export function getPriceIdForPlan(plan: PlanId): string | undefined {
  if (plan === "starter") return import.meta.env.VITE_PADDLE_PRICE_STARTER as string | undefined;
  if (plan === "pro") return import.meta.env.VITE_PADDLE_PRICE_PRO as string | undefined;
  return undefined;
}

export interface OpenCheckoutOptions {
  plan: PlanId;
  onComplete?: () => void;
  onClose?: () => void;
}

export async function openCheckout({ plan, onComplete, onClose }: OpenCheckoutOptions): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const paddle = await getPaddle();
  if (!paddle) {
    return { ok: false, reason: "Paddle is not enabled yet. Please enable Paddle test mode first." };
  }

  const priceId = getPriceIdForPlan(plan);
  if (!priceId) {
    return {
      ok: false,
      reason: `Missing VITE_PADDLE_PRICE_${plan.toUpperCase()} — set the ${plan} price id.`,
    };
  }

  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return { ok: false, reason: "You must be signed in to upgrade." };
  const email = data.user?.email ?? undefined;

  // Register a one-shot listener for this checkout's lifecycle.
  const handler = (event: PaddleEvent) => {
    if (event.name === "checkout.completed") {
      listeners.delete(handler);
      onComplete?.();
    } else if (event.name === "checkout.closed") {
      listeners.delete(handler);
      onClose?.();
    }
  };
  listeners.add(handler);

  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: email ? { email } : undefined,
    customData: { user_id: userId },
    settings: {
      displayMode: "overlay",
      theme: "light",
      successUrl: `${window.location.origin}/billing?checkout=success`,
      allowLogout: false,
    },
  });

  return { ok: true };
}
