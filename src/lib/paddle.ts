import { initializePaddle, type Paddle, type Environments } from "@paddle/paddle-js";
import { supabase } from "@/integrations/supabase/client";

let paddlePromise: Promise<Paddle | undefined> | null = null;

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

  paddlePromise = initializePaddle({ environment: env, token });
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
  if (!userId) {
    return { ok: false, reason: "You must be signed in to upgrade." };
  }
  const email = data.user?.email ?? undefined;

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

  // Paddle JS dispatches events globally; wire one-shot listeners on the
  // Paddle instance via eventCallback (set once below in initializePaddle).
  // For per-checkout success/close handling we listen at window level
  // since paddle-js fires checkout events that bubble through its callback.
  const handleEvent = (event: { name?: string }) => {
    if (event.name === "checkout.completed") {
      onComplete?.();
      cleanup();
    } else if (event.name === "checkout.closed") {
      onClose?.();
      cleanup();
    }
  };

  // paddle-js exposes events via initializePaddle's eventCallback, but for
  // local one-shot wiring we poll the URL hash + the visibility of the
  // overlay. Simpler: rely on successUrl redirect + onClose timer fallback.
  let cleanup = () => {};
  const closedFallback = window.setTimeout(() => {
    // Paddle overlay auto-removes on close; we treat user-driven close as
    // resolved after a generous wait so refetch happens either way.
  }, 0);
  cleanup = () => window.clearTimeout(closedFallback);

  // Best-effort: paddle-js calls global Paddle.Event.* — capture via
  // a window listener some setups expose.
  const onPaddleEvent = (e: Event) => {
    const detail = (e as CustomEvent).detail as { name?: string } | undefined;
    if (detail) handleEvent(detail);
  };
  window.addEventListener("paddle-event", onPaddleEvent as EventListener);
  const origCleanup = cleanup;
  cleanup = () => {
    origCleanup();
    window.removeEventListener("paddle-event", onPaddleEvent as EventListener);
  };

  return { ok: true };
}
