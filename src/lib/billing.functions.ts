import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Quota = {
  plan: "free" | "starter" | "pro";
  status: string;
  used: number;
  monthly_limit: number;
  period_month: string;
  current_period_end: string | null;
  paddle_subscription_id: string | null;
};

export const getQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Quota> => {
    const { supabase, userId } = context;
    const [quotaRes, subRes] = await Promise.all([
      supabase.rpc("get_user_quota", { _user_id: userId }),
      supabase
        .from("subscriptions")
        .select("current_period_end, paddle_subscription_id")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (quotaRes.error) throw new Error(quotaRes.error.message);
    const row = Array.isArray(quotaRes.data) ? quotaRes.data[0] : quotaRes.data;
    return {
      plan: row?.plan ?? "free",
      status: row?.status ?? "active",
      used: Number(row?.used ?? 0),
      monthly_limit: Number(row?.monthly_limit ?? 3),
      period_month: String(row?.period_month ?? ""),
      current_period_end: subRes.data?.current_period_end ?? null,
      paddle_subscription_id: subRes.data?.paddle_subscription_id ?? null,
    };
  });


export const consumeVideoQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ allowed: boolean; used: number; monthly_limit: number }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("increment_video_usage", { _user_id: userId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed),
      used: Number(row?.used ?? 0),
      monthly_limit: Number(row?.monthly_limit ?? 0),
    };
  });
